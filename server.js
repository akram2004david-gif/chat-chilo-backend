const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// CORS Configuration
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: false
}));

// Create HTTP server
const server = http.createServer(app);

// Socket.IO Configuration
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: false
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

// Queue and pairs
let waitingQueue = [];
let activePairs = {};

// Keep-alive mechanism to prevent Render from spinning down
const SERVER_URL = process.env.RENDER_EXTERNAL_URL || 'https://chat-chilo-backend.onrender.com';

function keepAlive() {
    console.log('🔔 Sending keep-alive ping...');
    
    const protocol = SERVER_URL.startsWith('https') ? https : http;
    
    protocol.get(SERVER_URL + '/health', (res) => {
        console.log('✅ Keep-alive ping successful:', res.statusCode);
    }).on('error', (err) => {
        console.log('⚠️ Keep-alive ping error:', err.message);
    });
}

// Ping every 10 minutes (before Render's 15 minute timeout)
setInterval(() => {
    keepAlive();
}, 10 * 60 * 1000);

// Also ping on startup
setTimeout(() => {
    keepAlive();
}, 5 * 60 * 1000);

// Socket.IO connection handler
io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);

    // Handle start_chat event
    socket.on('start_chat', () => {
        console.log('🔍 User requesting chat:', socket.id);
        
        if (waitingQueue.length > 0) {
            const partner = waitingQueue.shift();
            
            if (partner.id !== socket.id && partner.connected) {
                // Create pair
                activePairs[socket.id] = partner.id;
                activePairs[partner.id] = socket.id;
                
                // Notify both users
                socket.emit('matched', { partnerId: partner.id });
                partner.emit('matched', { partnerId: socket.id });
                
                console.log(`🔗 Matched: ${socket.id} ↔ ${partner.id}`);
            } else {
                // Partner not available, add back to queue
                waitingQueue.push(socket);
                socket.emit('waiting');
            }
        } else {
            // No one waiting, add to queue
            waitingQueue.push(socket);
            socket.emit('waiting');
            console.log('⏳ User in queue:', socket.id);
        }
    });

    // Handle message event
    socket.on('message', (data) => {
        const partnerId = activePairs[socket.id];
        if (partnerId) {
            io.to(partnerId).emit('message', { 
                text: data.text,
                from: socket.id 
            });
            console.log(`💬 Message from ${socket.id} to ${partnerId}: ${data.text}`);
        }
    });

    // Handle skip_partner event
    socket.on('skip_partner', () => {
        console.log('⏭️ User skipped partner:', socket.id);
        endPair(socket.id);
        
        // Add back to queue
        waitingQueue.push(socket);
        socket.emit('waiting');
    });

    // Handle end_chat event
    socket.on('end_chat', () => {
        console.log('🔚 User ended chat:', socket.id);
        endPair(socket.id);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('❌ User disconnected:', socket.id);
        endPair(socket.id);
        
        // Remove from queue
        waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    });

    // Helper function to end pair
    function endPair(socketId) {
        const partnerId = activePairs[socketId];
        if (partnerId) {
            // Notify partner
            if (io.sockets.sockets.has(partnerId)) {
                io.to(partnerId).emit('partner_disconnected');
            }
            delete activePairs[partnerId];
        }
        delete activePairs[socketId];
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'Server is running',
        timestamp: new Date().toISOString(),
        connectedUsers: io.engine.clientsCount,
        uptime: process.uptime()
    });
});

// Health check for Render and UptimeRobot
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Stats endpoint
app.get('/stats', (req, res) => {
    res.json({
        totalUsers: io.engine.clientsCount,
        waitingUsers: waitingQueue.length,
        activePairs: Object.keys(activePairs).length / 2,
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Server running on port', PORT);
    console.log('📡 WebSocket server ready');
    console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
    console.log('🔗 Server URL:', SERVER_URL);
    console.log('⏰ Keep-alive enabled - will ping every 10 minutes');
});

// Handle server errors
server.on('error', (error) => {
    console.error('❌ Server error:', error);
    process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('👋 SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Log unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Log uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

console.log('✅ Server initialized successfully');
