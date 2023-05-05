//4. Base de Datos Mongodb (Mongoose) -> https://www.youtube.com/watch?v=AknTRNvX9rA&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=5

const mongoose = require('mongoose');
require('dotenv').config();

//---------------- MongoDB Atlas -----------------
const URI = process.env.MONGODB_URI
// -----------------------------------------------

//---------------- MongoDB Local -----------------
//Documentacion: https://docs.mongodb.com/manual/tutorial/install-mongodb-on-os-x/
//En el bash: >>brew services start mongodb-community@4.4 o >>mongo
// const URI = 'mongodb://localhost/notes-app'

//Una vez instalado el Mongo Server Community, desde la terminal:
//mongo (para abrir el shell de mongodb)

//show dbs                  (mostrar las bases de datos)
//use notes-app             (entrar a usar la base de datos de notes-app)
//show collections          (ver las colecciones dentro de notes-app)
//db.notes.find().pretty()  (ver las colecciones dentro de la coleccion notes)
//db.users.find().pretty()  (ver todo lo que hay dentro de la coleccion users)
//quit()                    (salir)
// ------------------------------------------------

mongoose.connect(URI, {
    useNewUrlParser: true, 
    useUnifiedTopology: true,
    useFindAndModify: false,
    useCreateIndex: true
    })
    .then(db => console.log('Base de datos conectada'))
    .catch(err => console.error(err));

module.exports = mongoose;
//-------------------------------------------------