// this is adapated from https://github.com/gregrperkins/grunt-mocha-hack

"use strict";

module.exports = function(grunt) {
  var createDomain = require('domain').create;
  var mocha = require('./lib/mocha-runner');
  var mochaReporterBase = require('mocha/lib/reporters/base');
  var seleniumLauncher = require('selenium-launcher');
  var phantomjs = require('phantomjs');
  var path = require('path');

  grunt.registerMultiTask('mochaSelenium', 'Run functional tests with mocha', function() {
    var done = this.async();
    // Retrieve options from the grunt task.
    var options = this.options({
      browserName: 'firefox',
      usePromises: false,
      useFibers: false,
      useSystemPhantom: false
    });

    // We want color in our output, but when grunt-contrib-watch is used,
    //  mocha will detect that it's being run to a pipe rather than tty.
    // Mocha provides no way to force the use of colors, so, again, hack it.
    var priorUseColors = mochaReporterBase.useColors;
    if (options.useColors) {
      mochaReporterBase.useColors = true;
    }

    // More agnostic -- just remove *all* the uncaughtException handlers;
    //  they're almost certainly going to exit the process, which,
    //  in this case, is definitely not what we want.
    var uncaughtExceptionHandlers = process.listeners('uncaughtException');
    process.removeAllListeners('uncaughtException');
    var unmanageExceptions = function() {
      uncaughtExceptionHandlers.forEach(
        process.on.bind(process, 'uncaughtException'));
    };
    // Better, deals with more than just grunt?

    // Restore prior state.
    var restore = function() {
      mochaReporterBase.useColors = priorUseColors;
      unmanageExceptions();
      done();
    };

    grunt.util.async.forEachSeries(this.files, function(fileGroup, next){
      runTests(fileGroup, options, next);
    }, restore);
  });


  function runTests(fileGroup, options, next){

    // When we're done with mocha, dispose the domain
    var mochaDone = function(errCount) {
      var withoutErrors = (errCount === 0);
      // Indicate whether we failed to the grunt task runner
      next(withoutErrors);
    };

    if (options.browserName === 'phantomjs' && !options.useSystemPhantom) {
      // add npm-supplied phantomjs bin dir to PATH, so selenium can launch it
      process.env.PATH = path.dirname(phantomjs.path) + ':' + process.env.PATH;
    }

    seleniumLauncher({ chrome: options.browserName === 'chrome' }, function(err, selenium) {
      grunt.log.writeln('Selenium Running');
      if(err){
        selenium.exit();
        grunt.fail.fatal(err);
        return;
      }

      var browser, wrap;
      if(options.useFibers && options.usePromises) {
        throw new Error("The useFibers and usePromises options are mutually exclusive.");
      }
      if (options.useFibers) {
        var wdSync = require('wd-sync');
        var client = wdSync.remote({host: selenium.host, port: selenium.port});
        browser = client.browser;
        wrap = wdSync.wrap({ "with": function() { return browser; } });
      }
      else {
        var wd = require('wd');
        var remote = options.usePromises ? 'promiseRemote' : 'remote';
        browser = wd[remote](selenium.host, selenium.port);
      }

      var opts = {
        browserName: options.browserName
      };

      browser.on('status', function(info){
        grunt.log.writeln('\x1b[36m%s\x1b[0m', info);
      });

      browser.on('command', function(meth, path, data){
        grunt.log.debug(' > \x1b[33m%s\x1b[0m: %s', meth, path, data || '');
      });




      if(options.useFibers) {
        var Fiber = require('fibers');

        var testDomain = createDomain();
        testDomain.on('error', function(err) {
          console.log(err.stack.toString().red);
        });

        testDomain.run(wrap(function () {
          browser.init(opts);
          var runner = mocha(options, browser, grunt, fileGroup);
          console.log("Fiber from outside the callback:", Fiber.current);
          runner.run(function (err) {
            wrap(function () {
              console.log("And here we are back in the callback.");


              browser.quit();
              selenium.kill();
              mochaDone(err);
            });
          });
        }));



      } else {
        browser.init(opts, function(err){
          if(err){
            grunt.fail.fatal(err);
            return;
          }

          var runner = mocha(options, browser, grunt, fileGroup);
          // Create the domain, and pass any errors to the mocha runner
          var domain = createDomain();
          domain.on('error', runner.uncaught.bind(runner));

          // Give selenium some breathing room
          setTimeout(function(){
            // Selenium Download and Launch
            domain.run(function() {
              runner.run(function(err){
                browser.quit(function(){
                  selenium.kill();
                  mochaDone(err);
                });
              });
            });
          }, 300);
        });
      }
    });
  }
};
