// Initialize Socket.IO Connection
function initSocket() {
    updateConnectionStatus('connecting', '🟡 جاري الاتصال بالخادم...');
    
    try {
        console.log('🔌 Connecting to:', SERVER_URL);
        
        // استخدم io() بدلاً من new WebSocket()
        socket = io(SERVER_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5
        });
        
        socket.on('connect', function() {
            console.log('✅ Connected to server');
            updateConnectionStatus('connected', '🟢 متصل بالخادم ✓');
        });
        
        socket.on('disconnect', function() {
            console.log('❌ Disconnected from server');
            updateConnectionStatus('disconnected', '🔴 انقطع الاتصال بالخادم');
            if (isConnected) {
                addSystemMessage('انقطع الاتصال بالشريك');
                isConnected = false;
                enableInput(false);
            }
        });
        
        socket.on('connect_error', function(error) {
            console.log('Connection error:', error);
            updateConnectionStatus('disconnected', '🔴 خطأ في الاتصال - تحقق من الخادم');
            addSystemMessage('خطأ في الاتصال بالخادم');
        });
        
        // استمع للرسائل
        socket.on('matched', function(data) {
            onPartnerFound(data.partnerId);
        });
        
        socket.on('message', function(data) {
            receiveMessage(data.text);
        });
        
        socket.on('partner_disconnected', function() {
            addSystemMessage('غادر الشريك المحادثة');
            isConnected = false;
            enableInput(false);
        });
        
        socket.on('waiting', function() {
            addSystemMessage('جاري البحث عن شريك...');
        });
        
        socket.on('error', function(data) {
            addSystemMessage('خطأ: ' + data.message);
        });
        
    } catch (e) {
        console.log('Socket.IO init error:', e);
        updateConnectionStatus('disconnected', '🔴 فشل تهيئة الاتصال');
    }
}
