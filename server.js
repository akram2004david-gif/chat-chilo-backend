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
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e6 // 1MB max message size
});

// Queue and pairs
let waitingQueue = [];
let activePairs = {};

// Memory management
const MAX_MEMORY_USAGE = 400 * 1024 * 1024; // 400MB limit
const CLEANUP_INTERVAL = 5 * 60 * 1000; // Cleanup every 5 minutes
const MEMORY_CHECK_INTERVAL = 2 * 60 * 1000; // Check memory every 2 minutes

// Keep-alive mechanism
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

// Ping every 10 minutes
setInterval(() => {
    keepAlive();
}, 10 * 60 * 1000);

// Memory cleanup function
function cleanupMemory() {
    console.log('🧹 Starting memory cleanup...');
    
    // Clean disconnected sockets from active pairs
    let cleanedPairs = 0;
    for (const [socketId, partnerId] of Object.entries(activePairs)) {
        const socket = io.sockets.sockets.get(socketId);
        const partner = io.sockets.sockets.get(partnerId);
        
        if (!socket || !partner || !socket.connected || !partner.connected) {
            delete activePairs[socketId];
            delete activePairs[partnerId];
            cleanedPairs++;
            console.log(`🗑️ Cleaned inactive pair: ${socketId} - ${partnerId}`);
        }
    }
    
    // Clean disconnected sockets from queue
    const initialQueueLength = waitingQueue.length;
    waitingQueue = waitingQueue.filter(socket => {
        return socket && socket.connected;
    });
    
    const cleanedQueue = initialQueueLength - waitingQueue.length;
    console.log(`🗑️ Cleaned ${cleanedQueue} disconnected sockets from queue`);
    
    // Force garbage collection if available
    if (global.gc) {
        console.log('♻️ Forcing garbage collection...');
        global.gc();
    }
    
    const memoryUsage = process.memoryUsage();
    console.log('📊 Memory after cleanup:', {
        heapUsed: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
        heapTotal: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
        external: (memoryUsage.external / 1024 / 1024).toFixed(2) + ' MB'
    });
    
    console.log(`✅ Cleanup complete. Removed ${cleanedPairs} pairs and ${cleanedQueue} queue items`);
}

// Memory check function
function checkMemory() {
    const memoryUsage = process.memoryUsage();
    const heapUsed = memoryUsage.heapUsed;
    
    console.log('📊 Current memory usage:', {
        heapUsed: (heapUsed / 1024 / 1024).toFixed(2) + ' MB',
        heapTotal: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
        rss: (memoryUsage.rss / 1024 / 1024).toFixed(2) + ' MB'
    });
    
    if (heapUsed > MAX_MEMORY_USAGE) {
        console.warn('⚠️ High memory usage detected! Triggering cleanup...');
        cleanupMemory();
        
        // If still high after cleanup, restart
        setTimeout(() => {
            const newUsage = process.memoryUsage();
            if (newUsage.heapUsed > MAX_MEMORY_USAGE) {
                console.error('🚨 Critical memory usage! Initiating graceful restart...');
                gracefulRestart();
            }
        }, 5000);
    }
}

// Graceful restart function
function gracefulRestart() {
    console.log('🔄 Initiating graceful restart...');
    
    // Notify all connected users
    io.emit('server_restart', {
        message: 'Server is restarting for maintenance. Please reconnect in a few seconds.'
    });
    
    // Close server after 5 seconds
    setTimeout(() => {
        server.close(() => {
            console.log('✅ Server closed. Process will be restarted by Render...');
            process.exit(0);
        });
        
        // Force exit after 10 seconds
        setTimeout(() => {
            console.log('⚠️ Forcing process exit...');
            process.exit(1);
        }, 10000);
    }, 5000);
}

// Schedule regular cleanup
setInterval(cleanupMemory, CLEANUP_INTERVAL);

// Schedule memory checks
setInterval(checkMemory, MEMORY_CHECK_INTERVAL);

// Initial cleanup after 1 minute
setTimeout(cleanupMemory, 60 * 1000);

// Socket.IO connection handler
io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);
    console.log('📊 Active connections:', io.engine.clientsCount);

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
                console.log('📊 Active pairs:', Object.keys(activePairs).length / 2);
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
            console.log('📊 Queue length:', waitingQueue.length);
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
    socket.on('disconnect', (reason) => {
        console.log('❌ User disconnected:', socket.id, 'Reason:', reason);
        endPair(socket.id);
        
        // Remove from queue
        const initialLength = waitingQueue.length;
        waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
        
        if (waitingQueue.length < initialLength) {
            console.log('🗑️ Removed from queue. New length:', waitingQueue.length);
        }
        
        console.log('📊 Active connections:', io.engine.clientsCount);
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
    const memoryUsage = process.memoryUsage();
    res.json({ 
        status: 'Server is running',
        timestamp: new Date().toISOString(),
        connectedUsers: io.engine.clientsCount,
        waitingUsers: waitingQueue.length,
        activePairs: Object.keys(activePairs).length / 2,
        uptime: process.uptime(),
        memory: {
            heapUsed: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
            heapTotal: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
            rss: (memoryUsage.rss / 1024 / 1024).toFixed(2) + ' MB'
        }
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
    const memoryUsage = process.memoryUsage();
    res.json({
        totalUsers: io.engine.clientsCount,
        waitingUsers: waitingQueue.length,
        activePairs: Object.keys(activePairs).length / 2,
        uptime: process.uptime(),
        memory: {
            heapUsed: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
            heapTotal: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
            external: (memoryUsage.external / 1024 / 1024).toFixed(2) + ' MB',
            rss: (memoryUsage.rss / 1024 / 1024).toFixed(2) + ' MB'
        },
        config: {
            maxMemory: (MAX_MEMORY_USAGE / 1024 / 1024) + ' MB',
            cleanupInterval: CLEANUP_INTERVAL / 1000 + ' seconds',
            memoryCheckInterval: MEMORY_CHECK_INTERVAL / 1000 + ' seconds'
        }
    });
});

// Manual cleanup endpoint (for debugging)
app.post('/cleanup', (req, res) => {
    console.log('🧹 Manual cleanup triggered via API');
    cleanupMemory();
    res.json({ message: 'Cleanup triggered' });
});

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Server running on port', PORT);
    console.log('📡 WebSocket server ready');
    console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
    console.log('🔗 Server URL:', SERVER_URL);
    console.log('⏰ Keep-alive enabled - will ping every 10 minutes');
    console.log('🧹 Auto-cleanup enabled - every', CLEANUP_INTERVAL / 1000 / 60, 'minutes');
    console.log('📊 Memory check enabled - every', MEMORY_CHECK_INTERVAL / 1000 / 60, 'minutes');
    console.log('⚠️ Max memory limit:', MAX_MEMORY_USAGE / 1024 / 1024, 'MB');
});

// Handle server errors
server.on('error', (error) => {
    console.error('❌ Server error:', error);
    process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received, shutting down gracefully');
    
    // Notify all users
    io.emit('server_shutdown', {
        message: 'Server is shutting down for maintenance. Please reconnect shortly.'
    });
    
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
    
    // Force close after 10 seconds
    setTimeout(() => {
        console.log('⚠️ Forcing shutdown...');
        process.exit(1);
    }, 10000);
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
    // Try to cleanup before exit
    cleanupMemory();
    process.exit(1);
});

// Handle memory warnings
process.on('warning', (warning) => {
    console.warn('⚠️ Process warning:', warning);
    if (warning.name === 'MemoryWarning') {
        cleanupMemory();
    }
});

console.log('✅ Server initialized successfully');
console.log('🛡️ Memory management enabled');
