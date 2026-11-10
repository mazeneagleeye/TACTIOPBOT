require('dotenv').config();
const { MongoClient } = require('mongodb');
const shards = [
  'ac-btedaix-shard-00-00.jih0umm.mongodb.net',
  'ac-btedaix-shard-00-01.jih0umm.mongodb.net',
  'ac-btedaix-shard-00-02.jih0umm.mongodb.net'
];

async function testShard(host) {
  const uri = `mongodb://tactiopbot_web:hazemmazen10@${host}:27017/TACTIOPBOT?retryWrites=true&w=majority&tls=true`;
  console.log('Testing:', host);
  const client = new MongoClient(uri, { 
    serverSelectionTimeoutMS: 10000,
    tlsAllowInvalidCertificates: true
  });
  try {
    await client.connect();
    await client.db('TACTIOPBOT').command({ ping: 1 });
    console.log('SUCCESS:', host);
    process.exit(0);
  } catch (err) {
    console.log('FAILED:', host, '-', err.message);
  }
}

(async () => {
  for (const shard of shards) {
    await testShard(shard);
  }
  console.log('All shards failed');
  process.exit(1);
})();