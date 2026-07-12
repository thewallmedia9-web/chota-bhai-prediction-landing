const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/health', (_, res) => {
  res.json({ status: 'OK', service: 'Chota Bhai Prediction Landing' });
});

app.get('*', (_, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.listen(PORT, () => {
  console.log('Chota Bhai Prediction landing page running on port ' + PORT);
});
