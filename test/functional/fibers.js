var assert = require('assert');
var wdSync = require('wd-sync');




describe('Fiber-enabled WebDriver', function () {

  describe('injected browser executing a Google Search', function () {

    it('performs as expected', function (done) {
      var browser = this.browser;
      wrap = wdSync.wrap({ "with": function() { return browser; } });

      console.log("arguments:", arguments);
      
      wrap(function () {

        browser.get('http://google.com')
        var searchBox = browser.elementByName('q');
        searchBox.type('webdriver');
        var val = searchBox.getAttribute('value');
        console.log("this far");
        assert.equal(val, 'webdriver');
        done();
        
      })();
    });
  });
});
