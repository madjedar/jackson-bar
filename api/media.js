export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      topVideo: "assets/bg-video.mp4",
      course1Img: "assets/course-classic-bar.jpg",
      course2Img: "assets/course-extra-barman.jpg"
    });
  }

  if (req.method === 'POST') {
    return res.status(200).json({ success: true, data: req.body });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
