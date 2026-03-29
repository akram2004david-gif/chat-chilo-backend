const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST']
}));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: false
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

let waitingQueue = [];
let activePairs = {};

io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);

    socket.on('start_chat', () => {
        console.log('🔍 Looking for partner...', socket.id);
        
        if (waitingQueue.length > 0) {
            const partner = waitingQueue.shift();
            
            if (partner.id !== socket.id && partner.connected) {
                activePairs[socket.id] = partner.id;
                activePairs[partner.id] = socket.id;
                
                socket.emit('matched', { partnerId: partner.id });
                partner.emit('matched', { partnerId: socket.id });
                
                console.log(`🔗 Matched: ${socket.id} ↔ ${partner.id}`);
            } else {
                waitingQueue.push(socket);
                socket.emit('waiting');
            }
        } else {
            waitingQueue.push(socket);
            socket.emit('waiting');
            console.log('⏳ User in queue:', socket.id);
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
        console.log('⏭️ Skip partner:', socket.id);
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
        console.log('🔚 End chat:', socket.id);
        const partnerId = activePairs[socket.id];
        if (partnerId) {
            io.to(partnerId).emit('partner_disconnected');
            delete activePairs[partnerId];
        }
        delete activePairs[socket.id];
    });

    socket.on('disconnect', () => {
        console.log('❌ Disconnected:', socket.id);
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
    console.log(`🚀 Server running on port ${PORT}`);
});
