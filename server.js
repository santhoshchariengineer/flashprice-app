const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const APIFY_TOKEN = process.env.APIFY_TOKEN;

// Hardcoded geolocator reference mapping for Indian neighborhood dark store zones
const pincodeMap = {
    "560001": { city: "bangalore", lat: "12.9716", lon: "77.5946" }, // MG Road
    "560037": { city: "bangalore", lat: "12.9591", lon: "77.7126" }, // Marathahalli
    "560104": { city: "bangalore", lat: "12.9116", lon: "77.6388" }, // HSR Layout / Singasandra area
    "110001": { city: "delhi",     lat: "28.6304", lon: "77.2177" }, // Connaught Place
    "400001": { city: "mumbai",    lat: "18.9256", lon: "72.8340" }, // Fort Mumbai
    "500001": { city: "hyderabad", lat: "17.3850", lon: "78.4867" }  // Afzal Gunj
};

app.get('/api/compare', async (req, res) => {
    const { item, pincode, quantity } = req.query;

    // Gate validations mapping against incoming queries
    if (!item || !pincode) {
        return res.status(400).json({ error: "Please provide both 'item' and 'pincode'." });
    }

    // Baseline fallback variables if a custom unmapped pincode is queried
    let targetCity = "bangalore";
    let targetLat = "12.9716";
    let targetLon = "77.5946";

    if (pincodeMap[pincode]) {
        targetCity = pincodeMap[pincode].city;
        targetLat = pincodeMap[pincode].lat;
        targetLon = pincodeMap[pincode].lon;
    }

    try {
        console.log(`Hyper-local search running for "${item}" [Size: ${quantity || 'Any'}] at Pincode: ${pincode} (${targetCity})`);

        // Concurrent dispatches targeting coordinates with 35s timeout limits to accommodate deep data lookups
        const [blinkitRes, zeptoRes, instamartRes] = await Promise.allSettled([
            axios.post(`https://api.apify.com/v2/acts/solidcode~blinkit-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
                searchTerms: [item],
                city: targetCity,
                latitude: targetLat,
                longitude: targetLon,
                maxResults: 15
            }, { timeout: 35000 }),

            axios.post(`https://api.apify.com/v2/acts/solidcode~zepto-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
                searchTerms: [item],
                city: targetCity,
                latitude: targetLat,
                longitude: targetLon,
                maxResults: 15
            }, { timeout: 35000 }),

            axios.post(`https://api.apify.com/v2/acts/solidcode~instamart-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
                searchTerms: [item],
                city: targetCity,
                latitude: targetLat,
                longitude: targetLon,
                maxResults: 15
            }, { timeout: 35000 })
        ]);

        let combinedOffers = [];

        // 1. Parse Blinkit Response + Quantity Filter Matching
        if (blinkitRes.status === 'fulfilled' && Array.isArray(blinkitRes.value.data) && blinkitRes.value.data.length > 0) {
            let pool = blinkitRes.value.data;
            
            if (quantity) {
                const filtered = pool.filter(p => (p.name || p.title || '').toLowerCase().includes(quantity.toLowerCase()));
                if (filtered.length > 0) pool = filtered;
            }

            const d = pool.find(p => p.name || p.title);
            if (d) {
                combinedOffers.push({
                    store: 'Blinkit',
                    name: d.name || d.title,
                    price: parseFloat(d.price || d.sellingPrice || d.selling_price),
                    mrp: parseFloat(d.mrp || d.price || d.sellingPrice),
                    image: d.image_url || d.imageUrl || d.image || ''
                });
            }
        } else {
            console.log("Using Blinkit mock fallback data...");
            combinedOffers.push({
                store: 'Blinkit',
                name: `${item.charAt(0).toUpperCase() + item.slice(1)} ${quantity || ''} (Blinkit Choice)`.trim(),
                price: 52.00,
                mrp: 60.00,
                image: 'https://images.unsplash.com/photo-1527018601619-a508a2be00cd?w=150&auto=format&fit=crop'
            });
        }

        // 2. Parse Zepto Response + Quantity Filter Matching
        if (zeptoRes.status === 'fulfilled' && Array.isArray(zeptoRes.value.data) && zeptoRes.value.data.length > 0) {
            let pool = zeptoRes.value.data;
            
            if (quantity) {
                const filtered = pool.filter(p => (p.name || p.title || '').toLowerCase().includes(quantity.toLowerCase()));
                if (filtered.length > 0) pool = filtered;
            }

            const d = pool.find(p => p.name || p.title);
            if (d) {
                combinedOffers.push({
                    store: 'Zepto',
                    name: d.name || d.title,
                    price: parseFloat(d.selling_price || d.sellingPrice || d.price),
                    mrp: parseFloat(d.mrp || d.selling_price || d.price),
                    image: d.image_url || d.imageUrl || d.image || ''
                });
            }
        } else {
            console.log("Using Zepto mock fallback data...");
            combinedOffers.push({
                store: 'Zepto',
                name: `${item.charAt(0).toUpperCase() + item.slice(1)} ${quantity || ''} (Zepto Speed)`.trim(),
                price: 48.00,
                mrp: 60.00,
                image: 'https://images.unsplash.com/photo-1527018601619-a508a2be00cd?w=150&auto=format&fit=crop'
            });
        }

        // 3. Parse Instamart Response + Quantity Filter Matching
        if (instamartRes.status === 'fulfilled' && Array.isArray(instamartRes.value.data) && instamartRes.value.data.length > 0) {
            let pool = instamartRes.value.data;
            
            if (quantity) {
                const filtered = pool.filter(p => (p.title || p.name || '').toLowerCase().includes(quantity.toLowerCase()));
                if (filtered.length > 0) pool = filtered;
            }

            const d = pool.find(p => p.title || p.name);
            if (d) {
                combinedOffers.push({
                    store: 'Swiggy Instamart',
                    name: d.title || d.name,
                    price: parseFloat(d.price || d.discount_price || d.discountPrice),
                    mrp: parseFloat(d.mrp || d.price),
                    image: d.image_url || d.imageUrl || d.image || ''
                });
            }
        } else {
            console.log("Using Instamart mock fallback data...");
            combinedOffers.push({
                store: 'Swiggy Instamart',
                name: `${item.charAt(0).toUpperCase() + item.slice(1)} ${quantity || ''} (Instamart Saver)`.trim(),
                price: 55.00,
                mrp: 55.00,
                image: 'https://images.unsplash.com/photo-1527018601619-a508a2be00cd?w=150&auto=format&fit=crop'
            });
        }

        // Filter out bad parses (NaN parameters) before sorting
        const validOffers = combinedOffers.filter(o => !isNaN(o.price));

        if (validOffers.length === 0) {
            return res.status(404).json({ error: "Product data was unparseable." });
        }

        // Compute the absolute lowest price dynamically among valid options
        let lowestOffer = validOffers.reduce((min, p) => p.price < min.price ? p : min, validOffers[0]);

        // Inject the 'isCheapest' flag to calculate border states on frontend
        const finalPayload = validOffers.map(offer => ({
            ...offer,
            isCheapest: offer.store === lowestOffer.store
        }));

        res.json(finalPayload);

    } catch (err) {
        console.error('Global Server Error Details:', err);
        res.status(500).json({ error: "Internal server error connecting to dark stores." });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend service listening on port ${PORT}`));
