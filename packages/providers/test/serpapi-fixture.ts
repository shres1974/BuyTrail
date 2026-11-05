/** Hand-written SerpApi google_shopping response shaped like the public docs (not captured data). */
const r = (over: Record<string, unknown>) => ({
  position: 1,
  title: "Sony WH-1000XM5 Wireless Noise Canceling Headphones - Black",
  product_id: "111",
  product_link: "https://www.google.ca/search?ibp=oshop&amp;q=x&amp;prds=catalogid:111",
  source: "Best Buy",
  price: "$399.99",
  extracted_price: 399.99,
  delivery: "Free delivery",
  ...over,
});

export const FIXTURE = {
  search_metadata: { status: "Success" },
  shopping_results: [
    r({ position: 1 }),
    r({ position: 2, source: "Amazon.ca", price: "$348.00", extracted_price: 348, delivery: "$9.99 delivery" }),
    r({ position: 3, source: "Walmart.ca", price: "$379.00", extracted_price: 379, delivery: undefined }),
    r({ position: 4, source: "Costco", price: "$349.99", extracted_price: 349.99, delivery: "Free delivery on orders over $75" }),
    r({ position: 5, source: "eBay - audio_outlet", title: "Sony WH-1000XM5 Headphones Black - Renewed", price: "$259.00", extracted_price: 259, delivery: "Free delivery" }),
    r({ position: 6, source: "Visions", title: "Sony WH-1000XM5 Headphones Silver", price: "$329.99", extracted_price: 329.99 }),
    r({ position: 7, source: "Amazon.ca", title: "Replacement Ear Pads for Sony WH-1000XM5", price: "$19.99", extracted_price: 19.99 }),
    r({ position: 8, source: "London Drugs", title: "Sony WH-1000XM4 Wireless Headphones Black", price: "$279.99", extracted_price: 279.99 }),
    r({ position: 9, source: "Best Buy", price: "$389.99", extracted_price: 389.99 }), // same seller, cheaper → kept instead of #1
    r({ position: 10, source: "B&amp;H", price: "US$298.00", extracted_price: 298 }),
    r({ position: 11, source: "Affirm shop", price: "$33.33/mo", extracted_price: 33.33 }),
    r({ position: 12, source: undefined }),
    r({ position: 13, source: "Staples", price: "$389.99", extracted_price: 389.99, delivery: "Get it by Wed ($12)" }),
  ],
};
