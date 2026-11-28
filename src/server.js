
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

// 2026-11-28 (John): SPEED — gzip compression of rendered pages / JSON (Node's built-in zlib, no new package). The jobs page and
// the job page are several MB of HTML / embedded JSON; gzip typically cuts that 5-10x on the wire. Only text responses
// >= 2 KB sent with res.send / res.render / res.json, and only when the browser accepts gzip. Static files are not affected.
const zlib = require('zlib');
app.use((req, res, next) => {
    if(!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();
    const send = res.send.bind(res);
    res.send = function(body){
        if(req.method === 'HEAD' || res.get('Content-Encoding') || (typeof body !== 'string' && !Buffer.isBuffer(body))) return send(body);
        if(typeof body === 'string' && !res.get('Content-Type')) res.type('html');
        if(!/html|json|javascript|css|text|xml/.test(String(res.get('Content-Type') || ''))) return send(body);
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
        if(buf.length < 2048) return send(body);
        zlib.gzip(buf, { level: 6 }, (err, gz) => {
            res.send = send;
            if(err) return send(body);
            res.set('Content-Encoding', 'gzip'); res.append('Vary', 'Accept-Encoding');
            send(gz);
        });
        return res;
    };
    next();
});
//app.use(express.urlencoded({ extended: false }));  // <-- handles form data
//app.use(express.json());                           // <-- handles JSON (fix for uploadSchedule)
app.use(express.json({limit: '25mb'}));
app.use(express.urlencoded({limit: '25mb', extended: true}));
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

// 2026-11-15 (John): per-person dot colours for every page (res.locals.peopleColors = { name: '#rrggbb' }), from
// Manage Users (User.color). Cached 60 s; Manage Users clears the cache on save (global.mtxPeopleColorsAt = 0).
const UserForColors = require('./models/User');
app.use(async (req, res, next) => {
    try{
        if(!global.mtxPeopleColors || Date.now() - (global.mtxPeopleColorsAt || 0) > 60000){
            // only people who can be Responsible (roles user / leader / admin — same list as the Responsible dropdown)
            const us = await UserForColors.find({ color: { $nin: ['', null] }, role: { $in: ['user', 'leader', 'admin'] } }).select('name color').lean();
            global.mtxPeopleColors = {}; us.forEach(u => { if(u.name && /^#[0-9a-f]{6}$/i.test(u.color)) global.mtxPeopleColors[String(u.name).trim()] = u.color; });
            global.mtxPeopleColorsAt = Date.now();
        }
        res.locals.peopleColors = global.mtxPeopleColors;
    }catch(err){ res.locals.peopleColors = {}; }
    next();
});

// 2026-11-28 (John): SPEED phase 1 — the job page scripts (public/js/job/*.js, moved out of views/job.ejs). Pages link them as
// /js/job/<file>?v=<file modified time> (app.locals.jsv below), so the browser can keep them for a year: editing a file changes its
// time -> new URL -> fresh download. Served gzipped (built once per file version, kept in memory).
const fsJob = require('fs');
const JOB_JS_DIR = path.join(__dirname, 'public', 'js', 'job');
app.locals.jsv = f => { try { return Math.floor(fsJob.statSync(path.join(__dirname, 'public', f)).mtimeMs); } catch(e){ return 0; } };
const jobJsCache = {};
// CHANGED 2026-11-28: also the top-level public/js/*.js files (wbtTree, iscwsaModel, ...), same rules.
app.get(/^\/js\/(job\/)?([\w.-]+\.js)$/, (req, res, next) => {
    const f = (req.params[0] || '') + req.params[1];
    const p = path.join(__dirname, 'public', 'js', f);
    fsJob.stat(p, (err, st) => {
        if(err) return next();
        const key = f + ':' + st.mtimeMs, done = c => {
            res.set('Content-Type', 'application/javascript; charset=utf-8');
            res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
            res.append('Vary', 'Accept-Encoding');
            if(/\bgzip\b/.test(req.headers['accept-encoding'] || '')){ res.set('Content-Encoding', 'gzip'); return res.end(c.gz); }
            res.end(c.raw);
        };
        if(jobJsCache[f] && jobJsCache[f].key === key) return done(jobJsCache[f]);
        fsJob.readFile(p, (e2, raw) => { if(e2) return next();
            zlib.gzip(raw, { level: 9 }, (e3, gz) => { if(e3) return next(); jobJsCache[f] = { key, raw, gz }; done(jobJsCache[f]); }); });
    });
});

// ---------------------Routes:
app.use(require('./routes/index.routes'));
app.use(require('./routes/users.routes'));
app.use(require('./routes/notes.routes'));

// ---------------------Static Files:
app.use(express.static(path.join(__dirname, 'public')));

module.exports = app;
