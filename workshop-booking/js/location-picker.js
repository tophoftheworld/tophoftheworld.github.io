import { loadGoogleMaps } from "./maps-loader.js";

let placesService = null;

function getPlacesService() {
    if (placesService) return placesService;
    const div = document.createElement("div");
    placesService = new google.maps.places.PlacesService(div);
    return placesService;
}

async function searchPlaces(query) {
    const q = String(query || "").trim();
    if (q.length < 2) return [];

    await loadGoogleMaps();

    try {
        const lib = await google.maps.importLibrary("places");
        const Place = lib?.Place;
        if (Place?.searchByText) {
            const response = await Place.searchByText({
                textQuery: q,
                fields: ["id", "displayName", "formattedAddress", "location"],
                maxResultCount: 8,
            });
            return (response.places || [])
                .map((place) => {
                    const loc = place.location;
                    const lat = loc ? (typeof loc.lat === "function" ? loc.lat() : loc.lat) : null;
                    const lng = loc ? (typeof loc.lng === "function" ? loc.lng() : loc.lng) : null;
                    const name = place.displayName;
                    return {
                        placeId: place.id || null,
                        name: typeof name === "string" ? name : (name?.text ?? "Place"),
                        address: place.formattedAddress ?? "",
                        lat: Number.isFinite(lat) ? lat : null,
                        lng: Number.isFinite(lng) ? lng : null,
                    };
                })
                .filter((row) => row.placeId);
        }
    } catch {
        /* legacy fallback */
    }

    const service = getPlacesService();
    return new Promise((resolve) => {
        service.textSearch({ query: q }, (results, status) => {
            if (status !== google.maps.places.PlacesServiceStatus.OK || !results) {
                resolve([]);
                return;
            }
            resolve(
                results
                    .map((place) => {
                        const loc = place.geometry?.location;
                        return {
                            placeId: place.place_id || null,
                            name: place.name || "Place",
                            address: place.formatted_address || "",
                            lat: loc ? loc.lat() : null,
                            lng: loc ? loc.lng() : null,
                        };
                    })
                    .filter((row) => row.placeId)
                    .slice(0, 8)
            );
        });
    });
}

function escapeHtml(s) {
    return String(s || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

/**
 * @param {HTMLElement} container
 * @param {{ venue?: string, address?: string, placeId?: string, lat?: number|null, lng?: number|null }} value
 */
export function mountLocationPicker(container, value = {}) {
    const state = {
        venue: value.venue || value.name || "",
        address: value.address || "",
        placeId: value.placeId || "",
        lat: value.lat ?? null,
        lng: value.lng ?? null,
        picked: Boolean(value.placeId),
        searchTerm: "",
        suggestions: [],
        timer: null,
    };

    function renderSuggestions() {
        let list = container.querySelector(".location-suggestions");
        if (!list) return;
        if (!state.suggestions.length) {
            list.classList.add("hidden");
            list.innerHTML = "";
            return;
        }
        list.classList.remove("hidden");
        list.innerHTML = state.suggestions.map((row) => `
      <button type="button" class="location-suggestion" data-place-id="${escapeHtml(row.placeId)}">
        <span class="location-suggestion-name">${escapeHtml(row.name)}</span>
        ${row.address ? `<span class="location-suggestion-address">${escapeHtml(row.address)}</span>` : ""}
      </button>`).join("");
        wireSuggestionClicks(list);
    }

    function wireSuggestionClicks(list) {
        list.querySelectorAll(".location-suggestion").forEach((btn) => {
            btn.addEventListener("click", () => {
                const row = state.suggestions.find((s) => s.placeId === btn.dataset.placeId);
                if (!row) return;
                state.venue = row.name;
                state.address = row.address;
                state.placeId = row.placeId;
                state.lat = row.lat;
                state.lng = row.lng;
                state.picked = true;
                state.suggestions = [];
                render();
            });
        });
    }

    function render() {
        if (state.picked) {
            container.innerHTML = `
<div class="location-picked">
  <div class="location-picked-text">
    <div class="location-picked-name">${escapeHtml(state.venue)}</div>
    ${state.address ? `<div class="location-picked-address">${escapeHtml(state.address)}</div>` : ""}
  </div>
  <button type="button" class="location-clear-btn" aria-label="Clear location">&times;</button>
</div>`;
            container.querySelector(".location-clear-btn")?.addEventListener("click", () => {
                state.venue = "";
                state.address = "";
                state.placeId = "";
                state.lat = null;
                state.lng = null;
                state.picked = false;
                state.searchTerm = "";
                state.suggestions = [];
                render();
            });
            return;
        }

        container.innerHTML = `
<div class="location-search-wrap">
  <input type="search" class="location-search-input" placeholder="Search address or place" autocomplete="off" />
  <div class="location-suggestions hidden"></div>
</div>`;

        const input = container.querySelector(".location-search-input");
        input.value = state.searchTerm;
        input?.addEventListener("input", () => {
            state.searchTerm = input.value;
            if (state.timer) clearTimeout(state.timer);
            const q = state.searchTerm;
            state.timer = setTimeout(async () => {
                state.suggestions = await searchPlaces(q);
                if (input.value === q) renderSuggestions();
            }, 320);
        });
        renderSuggestions();
    }

    render();
    container._locationState = state;
}

export function readLocationPicker(container) {
    const state = container?._locationState;
    if (!state) return { venue: "", address: "", placeId: "", lat: null, lng: null };
    return {
        venue: state.venue || "",
        address: state.address || "",
        placeId: state.placeId || "",
        lat: state.lat,
        lng: state.lng,
    };
}

export function locationPickerIsValid(container) {
    const { placeId, venue } = readLocationPicker(container);
    return Boolean(placeId && venue);
}
