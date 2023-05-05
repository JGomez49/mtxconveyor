
//18, Proteger las rutas de Express con Passport -> https://www.youtube.com/watch?v=EdBZQ6IdlYs&list=PLo5lAe9kQrwqUEXK7oQbzv63KsdODzuAy&index=19

const helpers = {};

helpers.isAuthenticated = (req,res,next)=>{
    if(req.isAuthenticated()){
        return next();
    }
    req.flash('error_msg', 'Please Signin to access this URL.');
    res.redirect('/users/signin');
}

module.exports = helpers