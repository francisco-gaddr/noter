const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
            const parsed = JSON.parse(body || '{}');
            resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
            console.log("Raw body:", body);
            resolve({ statusCode: res.statusCode, body: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function run() {
  try {
    console.log('1. GET /api/notes');
    const getRes = await request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/notes',
      method: 'GET'
    });
    console.log('Status:', getRes.statusCode);
    console.log('Body:', getRes.body);

    console.log('\n2. POST /api/notes');
    const postRes = await request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/notes',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { title: 'Test Note', content: 'Content', tags: ['test'] });
    console.log('Status:', postRes.statusCode);
    console.log('Body:', postRes.body);
    
    const noteId = postRes.body._id;
    if (!noteId) {
        console.error('No ID returned, skipping update/delete');
        return;
    }

    console.log('\n3. PUT /api/notes/' + noteId);
    const putRes = await request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/notes/' + noteId,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { title: 'Updated Title' });
    console.log('Status:', putRes.statusCode);
    console.log('Body:', putRes.body);

    console.log('\n4. DELETE /api/notes/' + noteId);
    const delRes = await request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/notes/' + noteId,
      method: 'DELETE'
    });
    console.log('Status:', delRes.statusCode);
    console.log('Body:', delRes.body);

  } catch (err) {
    console.error(err);
  }
}

run();
