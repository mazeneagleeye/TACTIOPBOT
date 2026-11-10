require('dotenv').config();
const { MongoClient } = require('mongodb');
const uri = process.env.MONGODB_URI;

const tlsOptions = {
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.2',
  // Force specific ciphers
  ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384'
};

async function test() {
  console.log('URI:', uri);
  const client = new MongoClient(uri, { 
    serverSelectionTimeoutMS: 15000,
    tlsAllowInvalidCertificates: true,
    tls: true,
    // Try to force TLS 1.2
  });
  try {
    await client.connect();
    console.log('Connected successfully');
    await client.db('TACTIOPBOT').command({ ping: 1 });
    console.log('Ping succeeded');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

test();