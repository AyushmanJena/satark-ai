# Expo HAS CHANGED

Crowd Safety App — Implementation Plan

We are building an Expo React Native crowd-safety application using Expo Router.

Implement features one at a time.

Phase 1 — Crowd Map

Extend explore.tsx to:

Fetch crowd-density rectangles from the backend.
Display density regions on react-native-maps.
Track the user's location.
Show LOW, MODERATE, or EXTREME warnings based on proximity/overlap.
Keep API and geographic calculations modular.

Use mock data if the backend is unavailable.

Phase 2 — SOS

Add emergency-contact setup, persistent contacts, SOS button, location sharing, and backend alert integration.

Phase 3 — Safest Exit

Add safest-exit data, route visualization, device heading/compass, and an arrow pointing toward the safest exit.

Features in Mobile Frontend : 

```jsx
1. Takes user current location automatically 
2. Fetches heatmap data (every 10 seconds maybe) and shows hotspots 
3. Comparing the data gives warnings
4. Based on the current capacity of the venue 
5. When someone clicks SOS it sends location to authorities 
(and their emergency contacts but what if they called for someone else)
6. Gets all exit routes from backend, 
also gets the best exit route based on current location (from backend) then show direction
```

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.
