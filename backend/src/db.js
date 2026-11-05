import { GridFSBucket, MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
const db = client.db(process.env.MONGODB_DB || 'uscial');

export const profiles = db.collection('profiles');
export const posts = db.collection('posts');
export const messages = db.collection('messages');
export const events = db.collection('events'); // calendario compartido
export const quotes = db.collection('quotes'); // diccionario de poesía sonora
// Fotos, videos y avatares: GridFS divide los archivos en fragmentos dentro de MongoDB
// (así no aplica el límite de 16 MB por documento).
export const bucket = new GridFSBucket(db, { bucketName: 'media' });

/** Conecta a MongoDB (falla al arrancar si la URI es incorrecta). */
export async function connectDb() {
  await client.connect();
}
