const io = require('socket.io-client');

const API_URL = process.env.API_URL || 'https://localhost:3001/api';
const SOCKET_URL = process.env.SOCKET_URL || 'https://localhost:3001';

async function run() {
  console.log('Starting sync verification...');

  // 1. Register/Login to get token
  const username = `testuser${Date.now()}`;
  const password = 'password123';
  
  console.log(`Registering user: ${username}`);
  let res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  
  if (!res.ok) {
      console.log('Registration failed status:', res.status);
      console.log('Registration failed body:', await res.clone().text());
      // Try login if register fails (though username is unique)
      console.log('Registration failed, trying login...');
      res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
  }

  if (!res.ok) {
    console.error('Auth failed:', await res.text());
    process.exit(1);
  }

  const data = await res.json();
  const token = data.token;
  console.log('Got token:', token ? 'YES' : 'NO');

  // 2. Connect Socket
  const socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    secure: true
  });

  socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connect error:', err.message);
  });

  // 3. Listen for events
  const eventPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for note:created event'));
    }, 5000);

    socket.on('note:created', (payload) => {
      clearTimeout(timeout);
      console.log('RECEIVED note:created event!');
      resolve(payload);
    });
  });

  // 4. Create Note via API
  console.log('Creating note via API...');
  const createRes = await fetch(`${API_URL}/notes`, {
    method: 'POST',
    headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
        title: 'Test Note ' + Date.now(), // In real app this should be encrypted, but for event trigger test it might pass if validation allows
        content: 'Test Content', // Encrypted?
        type: 'note',
        tags: [],
        isEncrypted: false // If backend supports unencrypted for test
    })
  });

  // Note: If backend enforces encryption, this might fail validation.
  // But let's see. If validation fails, we might need to encrypt.
  // However, the goal is to see if *socket event* fires when a note is created.
  // If creation fails, event won't fire.
  
  if (!createRes.ok) {
      console.log('Note creation failed (likely due to validation/encryption), response:', await createRes.text());
      // We can try to send a "fake" encrypted string if needed, or just skip if we can't easily encrypt in this script.
      // Assuming backend might validate structure.
      // Let's try with dummy encrypted strings if first attempt fails.
  } else {
      console.log('Note created via API');
  }

  try {
    await eventPromise;
    console.log('SUCCESS: Realtime sync verified!');
    process.exit(0);
  } catch (err) {
    console.error('FAILURE:', err.message);
    process.exit(1);
  }
}

run();
