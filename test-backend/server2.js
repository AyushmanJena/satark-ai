const WebSocket = require('ws');

const PORT = 8082;

const wss = new WebSocket.Server({
    port: PORT,
});


// ============================================================
// HARD-CODED EXIT GATES
// ============================================================

const EXIT_GATES = [
    {
        id: 'gate-1',
        name: 'Main Gate',
        latitude: 20.295644,
        longitude: 85.836251,
    },

    {
        id: 'gate-2',
        name: 'North Gate',
        latitude: 20.297200,
        longitude: 85.836900,
    },

    {
        id: 'gate-3',
        name: 'South Gate',
        latitude: 20.293800,
        longitude: 85.836500,
    },

    {
        id: 'gate-4',
        name: 'East Gate',
        latitude: 20.295500,
        longitude: 85.839000,
    },

    {
        id: 'gate-5',
        name: 'West Gate',
        latitude: 20.295700,
        longitude: 85.833900,
    },
];


// ============================================================
// HAVERSINE DISTANCE
// ============================================================

function calculateDistance(
    latitude1,
    longitude1,
    latitude2,
    longitude2
) {
    const R = 6371000;

    const lat1 =
        latitude1 * Math.PI / 180;

    const lat2 =
        latitude2 * Math.PI / 180;

    const deltaLat =
        (latitude2 - latitude1) *
        Math.PI / 180;

    const deltaLng =
        (longitude2 - longitude1) *
        Math.PI / 180;

    const a =
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(deltaLng / 2) ** 2;

    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return R * c;
}


// ============================================================
// BEARING
// ============================================================

function calculateBearing(
    latitude1,
    longitude1,
    latitude2,
    longitude2
) {
    const lat1 =
        latitude1 * Math.PI / 180;

    const lat2 =
        latitude2 * Math.PI / 180;

    const deltaLng =
        (longitude2 - longitude1) *
        Math.PI / 180;

    const y =
        Math.sin(deltaLng) *
        Math.cos(lat2);

    const x =
        Math.cos(lat1) *
        Math.sin(lat2) -
        Math.sin(lat1) *
        Math.cos(lat2) *
        Math.cos(deltaLng);

    const bearing =
        Math.atan2(y, x) *
        180 /
        Math.PI;

    return (bearing + 360) % 360;
}


// ============================================================
// FIND CLOSEST EXIT
// ============================================================

function findBestExit(
    latitude,
    longitude
) {
    let bestExit = null;
    let shortestDistance = Infinity;

    for (const exit of EXIT_GATES) {

        const distance =
            calculateDistance(
                latitude,
                longitude,
                exit.latitude,
                exit.longitude
            );

        if (distance < shortestDistance) {

            shortestDistance = distance;
            bestExit = exit;

        }
    }

    if (!bestExit) {
        return null;
    }

    const bearing =
        calculateBearing(
            latitude,
            longitude,
            bestExit.latitude,
            bestExit.longitude
        );

    return {
        ...bestExit,

        distance: Math.round(
            shortestDistance
        ),

        bearing: Math.round(
            bearing
        ),
    };
}


// ============================================================
// WEBSOCKET CONNECTION
// ============================================================

wss.on('connection', (socket, request) => {

    const clientAddress =
        request.socket.remoteAddress;

    console.log(
        `\n[+] Client connected: ${clientAddress}`
    );


    // --------------------------------------------------------
    // Receive messages
    // --------------------------------------------------------

    socket.on('message', (message) => {

        try {

            const data =
                JSON.parse(
                    message.toString()
                );

            console.log(
                '\n[REQUEST]',
                data
            );


            // =================================================
            // EXIT REQUEST
            // =================================================

            if (
                data.type === 'EXIT_REQUEST'
            ) {

                const latitude =
                    Number(data.latitude);

                const longitude =
                    Number(data.longitude);


                // ------------------------------------------------
                // Validate coordinates
                // ------------------------------------------------

                if (
                    !Number.isFinite(latitude) ||
                    !Number.isFinite(longitude)
                ) {

                    socket.send(
                        JSON.stringify({
                            type: 'EXIT_RESPONSE',

                            success: false,

                            message:
                                'Invalid coordinates',
                        })
                    );

                    return;
                }


                // ------------------------------------------------
                // Find exit
                // ------------------------------------------------

                const exit =
                    findBestExit(
                        latitude,
                        longitude
                    );


                if (!exit) {

                    socket.send(
                        JSON.stringify({

                            type:
                                'EXIT_RESPONSE',

                            success: false,

                            message:
                                'No exit available',

                        })
                    );

                    return;
                }


                // ------------------------------------------------
                // Send response
                // ------------------------------------------------

                const response = {

                    type:
                        'EXIT_RESPONSE',

                    success: true,

                    exit,

                    timestamp:
                        new Date().toISOString(),

                };


                socket.send(
                    JSON.stringify(response)
                );


                console.log(
                    '[RESPONSE]',
                    response
                );

            }

        } catch (error) {

            console.error(
                '[ERROR] Invalid message:',
                error
            );


            socket.send(
                JSON.stringify({

                    type:
                        'EXIT_RESPONSE',

                    success: false,

                    message:
                        'Invalid JSON message',

                })
            );

        }

    });


    // --------------------------------------------------------
    // Client disconnected
    // --------------------------------------------------------

    socket.on('close', () => {

        console.log(
            `[-] Client disconnected: ${clientAddress}`
        );

    });


    // --------------------------------------------------------
    // Error
    // --------------------------------------------------------

    socket.on('error', (error) => {

        console.error(
            '[WebSocket Error]',
            error
        );

    });

});


// ============================================================
// SERVER STARTED
// ============================================================

console.log(
    '=========================================='
);

console.log(
    `WebSocket server running on port ${PORT}`
);

console.log(
    `ws://localhost:${PORT}`
);

console.log(
    '=========================================='
);

console.log(
    '\nAvailable exits:'
);

EXIT_GATES.forEach((exit) => {

    console.log(
        `- ${exit.name}: ` +
        `${exit.latitude}, ${exit.longitude}`
    );

});

console.log('');