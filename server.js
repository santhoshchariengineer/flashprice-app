const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const APIFY_TOKEN = process.env.APIFY_TOKEN;

app.get('/api/compare', async (req, res) => {
    const { item, city } = req.query;

    if (!item || !city) {
        return res.status(400).json({ error: "Please provide both 'item' and 'city'." });
    }

    try {
        console.log(`Searching for "${item}" in ${city}...`);

        // Fire requests to all platforms concurrently at the exact same split-second
        const [blinkitRes, zeptoRes, instamartRes] = await Promise.allSettled([
            axios.post(`https://api.apify.com/v2/acts/solidcode~blinkit-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
                searchTerms: [item], city: city.toLowerCase(), maxResults: 1
            }),
            axios.post(`https://api.apify.com/v2/acts/solidcode~zepto-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
                searchTerms: [item], city: city.toLowerCase(), maxResults: 1
            }),
            axios.post(`https://api.apify.com/v2/acts/solidcode~instamart-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
                searchTerms: [item], city: city.toLowerCase(), maxResults: 1
            })
        ]);

        let combinedOffers = [];

        // Parse Blinkit
        if (blinkitRes.status === 'fulfilled' && Array.isArray(blinkitRes.value.data) && blinkitRes.value.data[0]) {
            const d = blinkitRes.value.data[0];
            combinedOffers.push({ store: 'Blinkit', name: d.name, price: parseFloat(d.price), mrp: parseFloat(d.mrp || d.price), image: d.image_url || '' });
        }

        // Parse Zepto
        if (zeptoRes.status === 'fulfilled' && Array.isArray(zeptoRes.value.data) && zeptoRes.value.data[0]) {
            const d = zeptoRes.value.data[0];
            combinedOffers.push({ store: 'Zepto', name: d.name, price: parseFloat(d.selling_price), mrp: parseFloat(d.mrp || d.selling_price), image: d.image_url || '' });
        }

        // Parse Instamart
        if (instamartRes.status === 'fulfilled' && Array.isArray(instamartRes.value.data) && instamartRes.value.data[0]) {
            const d = instamartRes.value.data[0];
            combinedOffers.push({ store: 'Swiggy Instamart', name: d.title || d.name, price: parseFloat(d.price || d.discount_price), mrp: parseFloat(d.mrp || d.price), image: d.image_url || '' });
        }

        if (combinedOffers.length === 0) {
            return res.status(404).json({ error: "Product could not be found on any store." });
        }

        // Calculate the lowest price
        let lowestOffer = combinedOffers.reduce((min, p) => p.price < min.price ? p : min, combinedOffers[0]);

        // Inject the 'isCheapest' flag
        const finalPayload = combinedOffers.map(offer => ({
            ...offer,
            isCheapest: offer.store === lowestOffer.store
        }));

        res.json(finalPayload);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error connecting to dark stores." });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend service listening on port ${PORT}`));