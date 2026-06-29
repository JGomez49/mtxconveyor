// Se hace un objeto para definir las funciones y despues llamarlas
// desde index.router.js

const indexCtrl = {};
const SiteConfig = require('../models/SiteConfig');

const DEFAULT_BANNER = 'https://res.cloudinary.com/metacortexjohn/image/upload/v1769889664/Planit_poster_02_neaxo6.png';

indexCtrl.renderIndex = (req,res)=>{
    res.render('index.ejs')
};

indexCtrl.renderAbout = (req,res)=>{
    res.render('about.ejs')
};

indexCtrl.renderSignIn = async (req,res)=>{
    try {
        const cfg = await SiteConfig.findOne({ key: 'bannerUrl' }).lean();
        const bannerUrl = (cfg && cfg.value) ? cfg.value : DEFAULT_BANNER;
        res.render('signin.ejs', { bannerUrl });
    } catch(e) {
        res.render('signin.ejs', { bannerUrl: DEFAULT_BANNER });
    }
};

module.exports = indexCtrl;