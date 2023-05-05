//Para subir el projecto a GitHub:
    //git remote add origin https://github.com/JGomez49/Auth-Notes-mac.git
    //git add .
    //git commit -m "working on ...."
    //git push -u origin main


//Este proyecto es basado en FAZT Nodejs & Mongodb CRUD
//1. Herramientas -> https://www.youtube.com/watch?v=kGdC7Ov5IY4&list=TLPQMTQwNjIwMjFfIJD51S1a8Q&index=10
//2. Estructura -> https://www.youtube.com/watch?v=o9LCKgRPka4&list=TLPQMTQwNjIwMjFfIJD51S1a8Q&index=14
//3. Servidor Web Básico con Nodejs y Express -> https://www.youtube.com/watch?v=OmW8EVaiHKA&list=TLPQMTQwNjIwMjFfIJD51S1a8Q&index=15
//4. Base de Datos Mongodb (Mongoose) -> https://www.youtube.com/watch?v=AknTRNvX9rA&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=5
//5. Mongoose Modelos de la base de datos Mongodb -> https://www.youtube.com/watch?v=Iu3Ko3YKMlo&list=TLPQMTQwNjIwMjFfIJD51S1a8Q&index=9
//6. Handlebars -> https://www.youtube.com/watch?v=w8fTsP7Swts&list=TLPQMTQwNjIwMjFfIJD51S1a8Q&index=22
//7. Bootstrap 4 y Font Awesome -> https://www.youtube.com/watch?v=rkstpRcjZIw&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=8
//8. Rutas del Servidor Web con Expressjs -> https://www.youtube.com/watch?v=Hjp0nTY2dBk&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=9
//9. Rutas de Nodejs y Express para las Notas (CRUD) -> https://www.youtube.com/watch?v=OjJ2gJTfQhM&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=10
//10. Handlebars y el formulario para crear Notas -> https://www.youtube.com/watch?v=8sXcFXFOWK4&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=11
//11. Renderizando Lista Notas a traves de Handlebars -> https://www.youtube.com/watch?v=htlt7L8Yl1k&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=12
//12. Eliminando Notas en la base de datos Mongodb -> https://www.youtube.com/watch?v=dFb1r4rUYMQ&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=13
//13. Actualización de Notas de la base de datos -> https://www.youtube.com/watch?v=PQL_iwLKnRg&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=14
//14. Mensajes con connect-flash -> https://www.youtube.com/watch?v=YR5AmzlO-Ww&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=15
//15. Vistas de Login y Registro de Usuarios -> https://www.youtube.com/watch?v=l4K12TBbwKg&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=16
//16. Registro de Usuario o SignUp -> https://www.youtube.com/watch?v=EpomajNVcMk&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=17
//17. Login de Usuarios con Passport y bcrypt -> https://www.youtube.com/watch?v=NN-Jt6EjFAc&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=18
//18. Proteger las rutas de Express con Passport -> https://www.youtube.com/watch?v=EdBZQ6IdlYs&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=19
//19. Actualizando las notas publicas a privadas -> https://www.youtube.com/watch?v=kUAynvhin00&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=20
//20. Despliegue de aplicacion con Dominio, SSL en servidor de DigitalOcean -> https://www.youtube.com/watch?v=7XWFaSbFJww&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=21

require('dotenv').config();

const app = require('./server');
require('./database');

console.log('Hola ' + process.env.USER);
console.log('Hoy es: ' + Date());

app.listen(app.get('port'), ()=>{
    console.log('Escuchando en el puerto ' + app.get('port'));
})