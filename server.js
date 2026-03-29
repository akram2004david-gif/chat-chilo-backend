const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let waitingQueue = [];
let activePairs = {};

io.on('connection', (socket) => {
    console.log('✅ مستخدم جديد:', socket.id);

    socket.on('start_chat', () => {
        if (waitingQueue.length > 0) {
            const partner = waitingQueue.shift();
            
            if (partner.id !== socket.id && partner.connected) {
                activePairs[socket.id] = partner.id;
                activePairs[partner.id] = socket.id;
                
                socket.emit('matched', { partnerId: partner.id });
                partner.emit('matched', { partnerId: socket.id });
                
                console.log(`🔗 تم المطابقة: ${socket.id} ↔ ${partner.id}`);
            } else {
                waitingQueue.push(socket);
            }
        } else {
            waitingQueue.push(socket);
            socket.emit('waiting');
        }
    });

    socket.on('message', (data) => {
        const partnerId = activePairs[socket.id];
        if (partnerId) {
            io.to(partnerId).emit('message', { 
                text: data.text,
                from: socket.id 
            });
        }
    });

    socket.on('skip_partner', () => {
        const partnerId = activePairs[socket.id];
        if (partnerId) {
            io.to(partnerId).emit('partner_disconnected');
            delete activePairs[partnerId];
        }
        delete activePairs[socket.id];
        
        waitingQueue.push(socket);
        socket.emit('waiting');
    });

    socket.on('end_chat', () => {
        const partnerId = activePairs[socket.id];
        if (partnerId) {
            io.to(partnerId).emit('partner_disconnected');
            delete activePairs[partnerId];
        }
        delete activePairs[socket.id];
    });

    socket.on('disconnect', () => {
        console.log('❌ انقطع:', socket.id);
        const partnerId = activePairs[socket.id];
        if (partnerId) {
            if (io.sockets.sockets.has(partnerId)) {
                io.to(partnerId).emit('partner_disconnected');
            }
            delete activePairs[partnerId];
        }
        delete activePairs[socket.id];
        waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
});