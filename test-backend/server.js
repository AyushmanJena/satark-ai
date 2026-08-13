const WebSocket = require("ws");

const PORT = 8080;

const wss = new WebSocket.Server({
    port: PORT,
});

console.log(`WebSocket server running on ws://localhost:${PORT}`);

// How far the generated crowd regions extend around the user
const REGION_SIZE = 0.00035;

function getCrowdLevel(density) {
    if (density >= 80) {
        return "extreme";
    }

    if (density >= 50) {
        return "moderate";
    }

    return "low";
}

function createRegions(latitude, longitude) {

    const size = REGION_SIZE;

    /*
     * Create a 3 x 3 grid around the user's location.
     *
     *          ┌─────┬─────┬─────┐
     *          │  1  │  2  │  3  │
     *          ├─────┼─────┼─────┤
     *          │  4  │ YOU │  6  │
     *          ├─────┼─────┼─────┤
     *          │  7  │  8  │  9  │
     *          └─────┴─────┴─────┘
     */

    const regions = [];

    let id = 1;

    for (let row = -1; row <= 1; row++) {

        for (let col = -1; col <= 1; col++) {

            const south = latitude + row * size;
            const north = south + size;

            const west = longitude + col * size;
            const east = west + size;

            const density = Math.floor(Math.random() * 101);

            regions.push({
                id: `region-${id++}`,

                north,
                south,
                east,
                west,

                density,

                level: getCrowdLevel(density),
            });
        }
    }

    return regions;
}

function send(socket, data) {

    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }

}

wss.on("connection", (socket) => {

    console.log("Client connected");

    let userLocation = null;
    let densityInterval = null;

    // --------------------------------------------------
    // Receive messages from phone
    // --------------------------------------------------

    socket.on("message", (message) => {

        try {

            const data = JSON.parse(message.toString());

            console.log("Received:", data);

            // ------------------------------------------
            // Location received
            // ------------------------------------------

            if (data.type === "LOCATION_UPDATE") {

                userLocation = {
                    latitude: data.latitude,
                    longitude: data.longitude,
                };

                console.log(
                    `User location: ${data.latitude}, ${data.longitude}`
                );

                // Generate initial crowd regions
                const regions = createRegions(
                    userLocation.latitude,
                    userLocation.longitude
                );

                send(socket, {
                    type: "CROWD_UPDATE",

                    latitude: userLocation.latitude,
                    longitude: userLocation.longitude,

                    regions,

                    timestamp: new Date().toISOString(),
                });

                // Start sending density updates
                if (!densityInterval) {

                    densityInterval = setInterval(() => {

                        if (!userLocation) {
                            return;
                        }

                        const regions = createRegions(
                            userLocation.latitude,
                            userLocation.longitude
                        );

                        send(socket, {
                            type: "CROWD_UPDATE",

                            latitude: userLocation.latitude,
                            longitude: userLocation.longitude,

                            regions,

                            timestamp: new Date().toISOString(),
                        });

                        console.log(
                            `Sent crowd update for ${userLocation.latitude}, ${userLocation.longitude}`
                        );

                    }, 3000);
                }
            }

        } catch (error) {

            console.error(
                "Invalid WebSocket message:",
                error
            );

        }

    });

    // --------------------------------------------------
    // Client disconnected
    // --------------------------------------------------

    socket.on("close", () => {

        console.log("Client disconnected");

        if (densityInterval) {
            clearInterval(densityInterval);
        }

    });

    socket.on("error", (error) => {

        console.error(
            "WebSocket error:",
            error
        );

        if (densityInterval) {
            clearInterval(densityInterval);
        }

    });

});