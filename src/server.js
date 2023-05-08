
require('dotenv').config()

const express = require('express');
// const Handlebars = require('handlebars')
//const exphbs = require('express-handlebars');
const ejs = require('ejs');
const path = require('path');
const morgan = require('morgan');
const multer = require('multer');
const uuid = require('uuid');
const { request } = require('http');
// const {allowInsecurePrototypeAccess} = require('@handlebars/allow-prototype-access')
const methodOverride = require('method-override');
const flash = require('connect-flash');
const session = require('express-session');
var MongoDBStore = require('connect-mongodb-session')(session);

var store = new MongoDBStore({
    uri: process.env.MONGODB_URI,
    collection: 'mySessions'
  });
// Catch errors
store.on('error', function(error) {
    console.log(error);
  });

const passport = require('passport');
const { Store } = require('express-session');

// ---------------------Initializations:
const app = express();
require('./config/passport');

// ---------------------Settings:
app.set('port', process.env.PORT || 3000);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// app.engine('.hbs', exphbs({
//     handlebars: allowInsecurePrototypeAccess(Handlebars),
//     defaultLayout: 'main.hbs',
//     layoutsDir: path.join(app.get('views'),'layouts'),
//     partialsDir: path.join(app.get('views'),'partials'),
//     extname: '.hbs'
// }));
// app.set('view engine', '.hbs');

// ---------------------Middlewares:
app.use(morgan('dev'));
app.use(express.urlencoded({extended: false}));
app.use(methodOverride('_method'));

// ------------------------------------------
// app.use(session({
//     secret: 'secret',
//     store: store,
//     resave: true,
//     saveUninitialized: true
// }));
// ....................................
app.use(require('express-session')({
    secret: 'secret',
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 1 // 1 week
    },
    store: store,
    resave: true,
    saveUninitialized: true
  }));
// =========================================


app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

const storage = multer.diskStorage({
    destination: path.join(__dirname , 'public/img/uploads'),
    filename: (req, file, cb, filename) =>{
        cb(null, file.originalname);
    }
});
app.use(multer({storage: storage}).single('image'));

// ---------------------Global Variables:
app.use((req,res,next)=>{
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error');
    res.locals.user = req.user || null;
    next();
});

// ---------------------Routes:
app.use(require('./routes/index.routes'));
app.use(require('./routes/users.routes'));
app.use(require('./routes/notes.routes'));

// ---------------------Static Files:
app.set(express.static(path.join(__dirname, 'public')));

module.exports = app;
