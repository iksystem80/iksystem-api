const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;


// ============================================
// Global Middleware
// ============================================

const app = express();

app.use(cors());

app.use(bodyParser.json());

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// ============================================
// HTTP Server
// ============================================

const httpServer = http.createServer(app);


// ============================================
// Socket.IO
// ============================================

const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
});


// ============================================
// Socket.IO connection
// ============================================

io.on('connection', (socket) => {

    socket.on('join-location', (locationId) => {

        const location = `location-${locationId}`;

        socket.join(location);

    });

});


// ============================================
// Import Route Modules
// ============================================

const userRoutes = require('./routes/user');
const customerRoutes = require('./routes/customer')(io);
const employeeRoutes = require('./routes/employee');
const machineRoutes = require('./routes/machine');


// ============================================
// Mount Routers
// ============================================

app.use('/api/user', userRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/machine', machineRoutes);


// ============================================
// Health Check
// ============================================

app.get('/', (req, res) => {

    res.status(200).json({
        success: true,
        message: 'IK System API is running'
    });

});


// ============================================
// Start Server
// ============================================

httpServer.listen(PORT, '0.0.0.0', () => {

    console.log(`HTTP server running on port ${PORT}`);

});
