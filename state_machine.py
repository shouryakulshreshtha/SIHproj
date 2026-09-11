from enum import Enum

class TripState(Enum):
    SEARCHING = "searching"
    ASSIGNED = "assigned"
    IN_TRANSIT = "in_transit"
    HANDOVER = "handover"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"

# Define allowed transitions to prevent bad state bugs
ALLOWED_TRANSITIONS = {
    TripState.SEARCHING: [TripState.ASSIGNED, TripState.CANCELLED],
    TripState.ASSIGNED: [TripState.IN_TRANSIT, TripState.CANCELLED],
    TripState.IN_TRANSIT: [TripState.HANDOVER, TripState.DELIVERED],
    TripState.HANDOVER: [TripState.IN_TRANSIT, TripState.CANCELLED], # New driver picks it up
}

def transition_trip_state(current_state_str: str, new_state_str: str) -> str:
    """Core state machine logic for trips and segments[cite: 1]."""
    try:
        current_state = TripState(current_state_str)
        new_state = TripState(new_state_str)
    except ValueError:
        raise ValueError("Invalid state provided.")

    if new_state in ALLOWED_TRANSITIONS.get(current_state, []):
        return new_state.value
    else:
        raise ValueError(f"Illegal transition from {current_state.value} to {new_state.value}")