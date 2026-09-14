export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // On Vercel serverless, disk writes are ephemeral.
  // We notify the client-side JavaScript to store files directly into IndexedDB (JacksonBarDB)
  return res.status(200).json({
    success: false,
    useIndexedDB: true,
    message: 'Serverless deployment: storing media directly in browser IndexedDB database'
  });
}
