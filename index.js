'use strict';

const express = require('express');
const exphbs = require('express-handlebars');
const bodyParser = require('body-parser');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const mongoose = require('mongoose');
const validator = require('validator');

const app = express();
mongoose.connect(process.env.MONGO_URL);

const Users = require('./models/users.js');
const Tasks = require('./models/tasks.js');

// Configure our app
const store = new MongoDBStore({
  uri: process.env.MONGO_URL,
  collection: 'sessions',
});
app.engine('handlebars', exphbs({
  defaultLayout: 'main',
}));
app.use(express.static('css'));
app.set('view engine', 'handlebars');
app.use(bodyParser.urlencoded({
  extended: true,
})); // for parsing application/x-www-form-urlencoded
// Configure session middleware that will parse the cookies
// of an incoming request to see if there is a session for this cookie.
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: 'auto',
  },
  store,
}));

// Middleware that looks up the current user for this sesssion, if there
// is one.
app.use((req, res, next) => {
  if (req.session.userId) {
    Users.findById(req.session.userId, (err, user) => {
      if (!err) {
        res.locals.currentUser = user;
      }
      next();
    });
  } else {
    next();
  }
});

// Middleware that checks if a user is logged in. If so, the
// Request continues to be processed, otherwise a 403 is returned.
function isLoggedIn(req, res, next) {
  if (res.locals.currentUser) {
    next();
  } else {
    res.sendStatus(403);
  }
}

// Middleware that loads a users tasks if they are logged in.
// Assigns task to owner and collaborator
function loadUserTasks(req, res, next) {
  if(!res.locals.currentUser){
    return next();
  }
  Tasks.find({}).or([
    {owner: res.locals.currentUser},
    {collaborators: res.locals.currentUser.email}])
    .exec(function(err, tasks){
    if(err){
      err = 'Cannot find task!';
      res.render('index', {errors: err});
    } else {
        for(var i = 0; i < tasks.length; i++) {
            if (tasks[i].owner.toString() == res.locals.currentUser._id.toString()){
              tasks[i].isMyTask = true;
            }
          }
        res.locals.tasks = tasks;
      }
    next();
  });
}

// Return the home page after loading tasks for users, or not.
app.get('/', loadUserTasks, (req, res) => {
  res.render('index');
});

// Handle submitted form for new users
app.post('/user/register', loadUserTasks, (req, res) => {
  if(req.body.password !== req.body.passwordConfirmation) {
    res.render('index', {errors: "Password and password confirmation do not match"});
  }
    var newUser = new Users();
    newUser.hashed_password = req.body.password;
    newUser.email = req.body.email;
    newUser.name = req.body.name;
    newUser.save(function(err) {
      if(err){
        err = 'Error registering you!';
        res.render('index', {errors: err});
      } else {
        req.session.userId = newUser._id;
        res.redirect('/');
      }
    })
});

// Log a user in, check if user already exists and make sure passwords match
app.post('/user/login', (req, res) => {
  var user = Users.findOne({email: req.body.email}, function(err, user){
    if(err || !user){
      err = 'No user exists!';
      res.render('index', {errors: err});
      return;
    }

    user.comparePassword(req.body.password, function(err, isMatch) {
      if(err || !isMatch){
        res.send('bad password');
      } else {
        req.session.userId = user._id;
        res.redirect('/');
      }
    });
  });
});

// Log a user out
app.get('/user/logout', (req, res) => {
  req.session.destroy(function(){
    res.redirect('/');
  });
});

//  All the controllers and routes below this require
//  the user to be logged in.
app.use(isLoggedIn);

// Handle submission of new task form
// Check to see if task is complete or incomplete and change status
app.post('/tasks/:id/complete', (req, res) => {
  Tasks.findById(req.params.id, function(err, task) {
    if(err || !task){
      err = 'Could not find task!';
      res.render('index', {errors: err});
    } else if (!task.isComplete){
          Tasks.update({_id: req.params.id}, {isComplete: true}, function(err){
            if(err){
              err = 'Cannot complete task';
              res.render('index', {errors: err});
            } else {
              res.redirect('/');
            }
          });
    } else {
      if(task.isComplete == true){
        Tasks.update({_id: req.params.id}, {isComplete: false}, function(err){
          if(err || !task){
            err = 'Could not find task2!';
            res.render('index', {errors: err});
          } else {
            res.redirect('/');
          }
        });
      }
    }
  });
});

// Findi task id and delete task
app.post('/tasks/:id/delete', (req, res) => {
  Tasks.remove({_id: req.params.id}, function(err){
    if(err){
      err = 'Could not delete task!';
      return res.render('index', {errors: err});
    }else{
      res.redirect('/');
    }
  });
});

// Handle submission of new task form

app.post('/task/create', (req, res) => {
  var newTask = new Tasks();
  newTask.owner = res.locals.currentUser._id;
  newTask.name = req.body.name;
  newTask.description = req.body.description;
  newTask.collaborators = [req.body.collaborator1, req.body.collaborator2, req.body.collaborator3];
  // Sourced from TA office hours
  const goodEmails = newTask
    .collaborators
    .map(c => !c || c.length === 0 || validator.isEmail(c))
    .every(x => x);
  if (!goodEmails) {
    return res.render('index', {
      errors: ['Bad email'],
    });
  }
  newTask.isComplete = false;
  console.log(newTask.isComplete);
  return newTask.save(function(err, savedTask) {
    if(err || !savedTask ) {
      err = 'Error saving task!';
      console.log(err);
      res.render('index', {errors: err});
    } else {
        res.redirect('/');
    }
  });
});

// Start the server
app.listen(process.env.PORT, () => {
  console.log(`Example app listening on port ${process.env.PORT}`);
});
