const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: false
    },
    pingTimeout: 30000, // أقل استهلاكاً
    pingInterval: 10000,
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 5e5 // 500KB فقط
});

// استخدام Map بدلاً من Object (أسرع وأقل استهلاكاً)
let waitingQueue = [];
let activePairs = new Map(); // أفضل من {}

// Keep-alive
const SERVER_URL = process.env.RENDER_EXTERNAL_URL || 'https://chat-chilo-backend.onrender.com';

function keepAlive() {
    const protocol = SERVER_URL.startsWith('https') ? https : http;
    protocol.get(SERVER_URL + '/health').on('error', () => {});
}

setInterval(keepAlive, 10 * 60 * 1000); // كل 10 دقائق

// Socket.IO connection handler
io.on('connection', (socket) => {
    console.log('✅ Connected:', socket.id, '| Total:', io.engine.clientsCount);

    socket.on('start_chat', () => {
        console.log('🔍 Request chat:', socket.id);
        
        if (waitingQueue.length > 0) {
            const partner = waitingQueue.shift();
            
            if (partner.id !== socket.id && partner.connected) {
                activePairs.set(socket.id, partner.id);
                activePairs.set(partner.id, socket.id);
                
                socket.emit('matched', { partnerId: partner.id });
                partner.emit('matched', { partnerId: socket.id });
                
                console.log(`🔗 Matched: ${socket.id} ↔ ${partner.id} | Pairs:`, activePairs.size / 2);
            } else {
                waitingQueue.push(socket);
                socket.emit('waiting');
            }
        } else {
            waitingQueue.push(socket);
            socket.emit('waiting');
            console.log('⏳ In queue:', socket.id, '| Queue:', waitingQueue.length);
        }
    });

    socket.on('message', (data) => {
        const partnerId = activePairs.get(socket.id);
        if (partnerId) {
            io.to(partnerId).emit('message', { text: data.text });
        }
    });

    socket.on('skip_partner', () => {
        console.log('⏭️ Skip:', socket.id);
        cleanupPair(socket.id);
        waitingQueue.push(socket);
        socket.emit('waiting');
    });

    // ⭐ تنظيف فوري عند إنهاء المحادثة
    socket.on('end_chat', () => {
        console.log('🔚 End chat:', socket.id);
        cleanupPair(socket.id);
    });

    // ⭐ تنظيف فوري عند الانقطاع
    socket.on('disconnect', (reason) => {
        console.log('❌ Disconnected:', socket.id, '| Reason:', reason);
        cleanupPair(socket.id);
        
        // إزالة من الطابور
        const index = waitingQueue.findIndex(s => s.id === socket.id);
        if (index > -1) {
            waitingQueue.splice(index, 1);
        }
        
        console.log('📊 Total:', io.engine.clientsCount, '| Pairs:', activePairs.size / 2, '| Queue:', waitingQueue.length);
    });

    // دالة التنظيف الفوري
    function cleanupPair(socketId) {
        const partnerId = activePairs.get(socketId);
        
        if (partnerId) {
            // إشعار الشريك
            const partnerSocket = io.sockets.sockets.get(partnerId);
            if (partnerSocket && partnerSocket.connected) {
                partnerSocket.emit('partner_disconnected');
            }
            
            // حذف الزوجين من Map
            activePairs.delete(socketId);
            activePairs.delete(partnerId);
            
            console.log('🗑️ Cleaned pair:', socketId, '| Remaining:', activePairs.size / 2);
        } else {
            activePairs.delete(socketId);
        }
    }
});

// Health endpoints
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK',
        users: io.engine.clientsCount,
        pairs: activePairs.size / 2,
        queue: waitingQueue.length,
        uptime: Math.floor(process.uptime()) + 's'
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: Date.now() });
});

app.get('/stats', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        users: io.engine.clientsCount,
        pairs: activePairs.size / 2,
        queue: waitingQueue.length,
        memory: {
            heap: (mem.heapUsed / 1024 / 1024).toFixed(1) + 'MB',
            rss: (mem.rss / 1024 / 1024).toFixed(1) + 'MB'
        },
        uptime: Math.floor(process.uptime()) + 's'
    });
});

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Server on port', PORT);
    console.log('🔗 URL:', SERVER_URL);
    console.log('⚡ Optimized for low RAM usage');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM - Shutting down');
    io.emit('server_shutdown', { message: 'Server restarting' });
    setTimeout(() => process.exit(0), 3000);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err.message);
});

console.log('✅ Server ready - Minimal RAM usage mode');
