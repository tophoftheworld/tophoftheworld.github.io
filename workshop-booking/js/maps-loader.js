import { GOOGLE_MAPS_API_KEY } from "./maps-config.js";

let loadPromise = null;

export function loadGoogleMaps() {
    if (window.google?.maps) return Promise.resolve();
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
        window.__workshopMapsReady = () => resolve();
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places&loading=async&callback=__workshopMapsReady`;
        script.async = true;
        script.onerror = () => reject(new Error("Failed to load Google Maps"));
        document.head.appendChild(script);
    });

    return loadPromise;
}
