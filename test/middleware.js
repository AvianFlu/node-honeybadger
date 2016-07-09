var assert = require('assert'),
    sinon = require('sinon'),
    express = require('express'),
    request = require('supertest'),
    nock   = require('nock'),
    Singleton = require('../lib/honeybadger');

describe('Express Middleware', function () {
  var subject, client_mock, client;
  var error = new Error('Badgers!');

  setup(function() {
    client = Singleton.factory({ apiKey: 'fake api key' });
    subject = client.errorHandler;

    client_mock = sinon.mock(client);
  });

  it('calls next', function() {
    var app = express();
    var expected = sinon.spy();

    app.use(function(req, res, next) {
      throw(error);
    });
    app.use(subject);
    app.use(function(err, req, res, next) {
      expected();
    });

    request(app.listen())
    .get('/')
    .end(function(err, res){
      if (err) return done(err);
      assert(expected.called);
      done();
    });
  });

  it('reports the error to Honeybadger', function(done) {
    var app = express();

    app.use(function(req, res, next) {
      throw(error);
    });
    app.use(subject);

    request(app.listen())
    .get('/')
    .end(function(err, res){
      if (err) return done(err);
      client_mock.verify();
      done();
    });
  });

  it('reports async errors to Honeybadger', function(done) {
    var app = express();

    app.use(client.requestHandler);
    app.use(function(req, res, next) {
      setTimeout(function asyncThrow() {
        throw(error);
      }, 0);
    });
    app.use(subject);

    client_mock.expects('notify').once().withArgs(error);

    request(app.listen())
    .get('/')
    .end(function(err, res){
      if (err) return done(err);
      client_mock.verify();
      done();
    });
  });

  it('reports metrics to Honeybadger', function(done) {
    var app = express();

    app.use(client.metricsHandler);

    client_mock.expects('timing').once().withArgs("app.request.404");

    request(app.listen())
    .get('/')
    .end(function(err, res){
      if (err) return done(err);
      client_mock.verify();
      done();
    });
  });
});

describe('Lambda Handler', function () {
  var api;
  var Honeybadger;

  setup(function() {
    Honeybadger = Singleton.factory({ apiKey: 'fake api key' });
    api = nock("https://api.honeybadger.io")
      .post("/v1/notices")
      .reply(201, '{"id":"1a327bf6-e17a-40c1-ad79-404ea1489c7a"}')
  });

  it('calls original handlers with arguments', function() {
    var handlerFunc = sinon.spy();
    var handler = Honeybadger.lambdaHandler(handlerFunc);
    handler(1, 2, 3);
    assert(handlerFunc.calledWith(1, 2, 3));
  });

  it('reports errors to Honeybadger', function() {
    sinon.spy(Honeybadger, 'notify');

    var handler = Honeybadger.lambdaHandler(function() {
      throw new Error("Badgers!");
    });

    assert.throws(function(){
      handler({}, {}, function(){});
    }, /Badgers!/);

    assert(Honeybadger.notify.called);
  });

  it('reports async errors to Honeybadger', function(done) {
    sinon.spy(Honeybadger, 'notify');

    Honeybadger.lambdaHandler(function() {
      setTimeout(function() {
        throw new Error("Badgers!");
      }, 0);
    })({}, {}, function(){});

    setTimeout(function assertion() {
      assert(Honeybadger.notify.calledOnce);
      done();
    }, 10);
  });

  context("pre-nodejs4.3 runtime", function() {
    it('reports errors to Honeybadger', function(done) {
      var context = {
        fail: function(err) {
          api.done();
          done();
        }
      };

      var handler = Honeybadger.lambdaHandler(function(event, context) {
        throw new Error("Badgers!");
      });

      assert.throws(function(){
        handler({}, context);
      }, /Badgers!/);
    });

    it('reports async errors to Honeybadger', function(done) {
      var context = {
        fail: function(err) {
          api.done();
          done();
        }
      };

      var handler = Honeybadger.lambdaHandler(function(event, context) {
        setTimeout(function() {
          throw new Error("Badgers!");
        }, 0);
      });

      handler({}, context);
    });
  });
});
