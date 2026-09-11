-- Enums for our State Machine
CREATE TYPE role_enum AS ENUM ('shipper', 'driver', 'admin', 'ops');
CREATE TYPE trip_status AS ENUM ('searching', 'assigned', 'in_transit', 'handover', 'delivered', 'cancelled');

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(15) UNIQUE NOT NULL,
    role role_enum NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trips (
    id SERIAL PRIMARY KEY,
    shipper_id INT REFERENCES users(id),
    origin VARCHAR(255) NOT NULL,
    destination VARCHAR(255) NOT NULL,
    total_fare DECIMAL(10, 2),
    status trip_status DEFAULT 'searching',
    is_relay BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE segments (
    id SERIAL PRIMARY KEY,
    trip_id INT REFERENCES trips(id),
    driver_id INT REFERENCES users(id),
    start_hub VARCHAR(255),
    end_hub VARCHAR(255),
    status trip_status DEFAULT 'searching',
    sequence_order INT,
    handover_otp VARCHAR(6)
);