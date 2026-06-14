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

        // Target clean lowercase values for the Apify Actor enum requirements
        const searchCity = city.toLowerCase().trim();

        // Fire requests to all platforms concurrently using verified Apify solidcode schemas
        const [blinkitRes, zeptoRes, instamartRes] = await Promise.allSettled([
            axios.post(`https://api.apify.com/v2/acts/solidcode~blinkit-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
                searchTerms: [item],
                city: searchCity,
                maxResults: 5
            }, { timeout: 30000 }),

            axios.post(`https://api.apify.com/v2/acts/solidcode~zepto-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
                searchTerms: [item],
                city: searchCity,
                maxResults: 5
            }, { timeout: 30000 }),

            axios.post(`https://api.apify.com/v2/acts/solidcode~instamart-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
                searchTerms: [item],
                city: searchCity,
                maxResults: 5
            }, { timeout: 30000 })
        ]);

        let combinedOffers = [];

        // 1. Parse Blinkit Response
        if (blinkitRes.status === 'fulfilled' && Array.isArray(blinkitRes.value.data) && blinkitRes.value.data.length > 0) {
            // Find the first valid product item matching the criteria
            const d = blinkitRes.value.data.find(p => p.name || p.title);
            if (d) {
                combinedOffers.push({
                    store: 'Blinkit',
                    name: d.name || d.title,
                    price: parseFloat(d.price || d.sellingPrice || d.selling_price),
                    mrp: parseFloat(d.mrp || d.price || d.sellingPrice),
                    image: d.image_url || d.imageUrl || d.image || ''
                });
            }
        } else if (blinkitRes.status === 'rejected') {
            console.error('Blinkit Scraper error connection failed:', blinkitRes.reason.message);
        }

        // 2. Parse Zepto Response
        if (zeptoRes.status === 'fulfilled' && Array.isArray(zeptoRes.value.data) && zeptoRes.value.data.length > 0) {
            const d = zeptoRes.value.data.find(p => p.name || p.title);
            if (d) {
                combinedOffers.push({
                    store: 'Zepto',
                    name: d.name || d.title,
                    price: parseFloat(d.selling_price || d.sellingPrice || d.price),
                    mrp: parseFloat(d.mrp || d.selling_price || d.price),
                    image: d.image_url || d.imageUrl || d.image || ''
                });
            }
        } else if (zeptoRes.status === 'rejected') {
            console.error('Zepto Scraper error connection failed:', zeptoRes.reason.message);
        }

        // 3. Parse Instamart Response
        if (instamartRes.status === 'fulfilled' && Array.isArray(instamartRes.value.data) && instamartRes.value.data.length > 0) {
            const d = instamartRes.value.data.find(p => p.title || p.name);
            if (d) {
                combinedOffers.push({
                    store: 'Swiggy Instamart',
                    name: d.title || d.name,
                    price: parseFloat(d.price || d.discount_price || d.discountPrice),
                    mrp: parseFloat(d.mrp || d.price),
                    image: d.image_url || d.imageUrl || d.image || ''
                });
            }
        } else if (instamartRes.status === 'rejected') {
            console.error('Instamart Scraper error connection failed:', instamartRes.reason.message);
        }

        // Return a clean 404 message if all endpoints returned empty results
        if (combinedOffers.length === 0) {
            return res.status(404).json({ error: "Product could not be found on any store." });
        }

        // Filter out bad parses (NaN prices) before math calculations
        const validOffers = combinedOffers.filter(o => !isNaN(o.price));

        if (validOffers.length === 0) {
            return res.status(404).json({ error: "Product data was unparseable." });
        }

        // Calculate the lowest price
        let lowestOffer = validOffers.reduce((min, p) => p.price < min.price ? p : min, validOffers[0]);

        // Inject the 'isCheapest' conditional tracking flag
        const finalPayload = validOffers.map(offer => ({
            ...offer,
            isCheapest: offer.store === lowestOffer.store
        }));

        res.json(finalPayload);

    } catch (err) {
        console.error('Global Application Error:', err);
        res.status(500).json({ error: "Internal server error connecting to dark stores." });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend service listening on port ${PORT}`));
