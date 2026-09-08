const express = require('express');
// const https = require('https');
const http = require('http');
const fs = require('fs');
const sql = require('mssql');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');


const PORT = process.env.PORT || 3000;

// Global Middleware
const app = express();

//for local certificate
// const options = {
//     key: fs.readFileSync('./certs/localhost-key.pem'),
//     cert: fs.readFileSync('./certs/localhost.pem'),
// };

app.use(cors());
app.use(bodyParser.json());

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// ============================================
// Create HTTPS Server
// ============================================

//const httpsServer = https.createServer(options, app);


const server = http.createServer(app);

// ============================================
// Socket.IO
// ============================================

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
});


// Socket.IO connection
io.on('connection', (socket) => {

    // console.log('Socket connected:', socket.id);

    // Vue sends the location ID after connecting
    socket.on('join-location', (locationId) => {

        const location = `location-${locationId}`;

        socket.join(location);

       // console.log(`Socket ${socket.id} joined ${location}`);
    });

    socket.on('disconnect', () => {
       // console.log('Socket disconnected:',socket.id);
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
// Start Server
// ============================================

server.listen(PORT, '0.0.0.0', () => {

    console.log(`HTTPS server running at https://localhost:${PORT}`);

});
