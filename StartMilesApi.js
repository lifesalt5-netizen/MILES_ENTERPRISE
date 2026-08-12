'use strict';

/*
  Dedicated MILES API process.
  The API must not share an event loop with Worker Runtime / TaskQueue execution,
  because synchronous queue locking can otherwise leave port 3000 bound but
  unable to answer health requests.
*/

process.env.MILES_ROOT = process.env.MILES_ROOT || __dirname;

require('./API/server');
