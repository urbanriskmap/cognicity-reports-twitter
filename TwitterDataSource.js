'use strict';

// Prototype object this object extends from - contains basic twitter interaction functions
var BaseTwitterDataSource = require('../BaseTwitterDataSource/BaseTwitterDataSource.js');

// Request module to call cognicity-server
var request = require('request');

// GRASP card
var options = {
  host: process.env.SERVER,
  path: '/cards',
  method: 'POST',
  port: 80,
  headers: {
    'x-api-key': process.env.X_API_KEY,
    'Content-Type': 'application/json'
  }
};

// Information to be tweeted to the user
var dialogue = {
  ahoy: {
    en: "Hello, I am RiskMapBot, reply with #flood to send me your flood report.",
    id: "Halo, saya RiskMapBot. Untuk melaporkan banjir di sekitarmu, silakan balas dengan #banjir."
  },
  requests: {
    card : {
      en: 'Hi! Open this link to input flood location, flood description, & photos.',
      id: 'Hai! Gunakan link ini untuk menginput lokasi banjir, keterangan, & foto.'
    }
  }
};

// moment time library
var moment = require('moment');

/**
 * The Twitter data source.
 * Connect to the Twitter stream and process matching tweet data.
 * @constructor
 * @augments BaseTwitterDataSource
 * @param {Reports} reports An instance of the reports object.
 * @param {object} twitter Configured instance of twitter object from ntwitter module
 * @param {object} config Twitter specific configuration.
 */
var TwitterDataSource = function TwitterDataSource(
		reports,
		twitter,
		config
	){

	// Store references to constructor arguments
	this.config = config;

	BaseTwitterDataSource.call(this, reports, twitter);

	// Create a list of keywords and usernames from config
	this.config.twitter.keywords = this.config.twitter.track.split(',');
	this.config.twitter.usernames = this.config.twitter.users.split(',');

	// Set constructor reference (used to print the name of this data source)
	this.constructor = TwitterDataSource;
};

// Set our prototype to be the base object
TwitterDataSource.prototype = Object.create( BaseTwitterDataSource.prototype );

/**
 * Data source configuration.
 * This contains the data source specific configuration.
 * @type {object}
 */
TwitterDataSource.prototype.config = {};

/**
 * Connect the Twitter stream.
 */
TwitterDataSource.prototype.start = function(){
	var self = this;

	// Stream
	function connectStream(){

		if (self.config.twitter.stream === true) {
			self.twitter.stream( 'statuses/filter', {
					'locations': self.config.twitter.bbox,
					'track': self.config.twitter.track
				}, function(stream){
					stream.on('data', function (data){
						self.logger.info('stream has data');
						if (data.warning) {
							self.logger.warn( JSON.stringify(data.warning.code) + ':' + JSON.stringify(data.warning.message) );
						}
						if (data.disconnect) {
							self.logger.error( 'disconnect code:' + JSON.stringify(data.disconnect.code) );
						} else {
							self.filter(data);
							time = new Date().getTime(); // Updated the time with last tweet.
						}
					});
					stream.on('error', function(error, code){
						self.logger.error( 'Twitter stream error: ' + JSON.stringify(error) + JSON.stringify(code) );
						self.logger.error( 'Stream error details: ' + JSON.stringify(arguments)); // Added extra log details to help with debugging.
					});
					stream.on('end', function(){
						self.logger.info('stream has been disconnected');
					});
					stream.on('destroy', function(){
						self.logger.info('stream has died');
					});
					// Catch an un-handled disconnection
					if ( time !== 0 ){
						if ( new Date().getTime() - time > self.config.twitter.stream.timeout ){
							// Try to destroy the existing stream
							self.logger.error( new Date()+': Un-handled stream error, reached timeout - attempting to reconnect' );
							stream.destroy();
							// Start stream again and reset time.
							time = 0;
							self.connectStream();
						}
					}
				}
			);
		}
	}

	var time = 0;
	// Brute force stream management  - create a new stream if existing one dies without a trace.
	function forceStreamAlive(){
		if (time !== 0){
			if ( new Date().getTime() - time > self.config.twitter.timeout ){
				self.logger.error(new Date()+': Timeout for connectStream() function - attempting to create a new stream');
				time = 0;
				connectStream();
			}
		}
		setTimeout( forceStreamAlive, 1000 );
	}

	self.logger.info( 'stream started' );
	connectStream();
	forceStreamAlive();
};

/**
 * Twitter tweet API object.
 * @see {@link https://dev.twitter.com/overview/api/tweets}
 * @typedef Tweet
 */

/**
 * Handle an incoming tweet.
 * Filter it based on our matching criteria and respond appropriately -
 * saving to the database, sending a tweet to the author, ignoring, etc.
 * @param {Tweet} tweet The tweet object to process
 */
TwitterDataSource.prototype.filter = function(tweet) {
	var self = this;

	function botTweet(err, message){
		if (err){
			self.logger.error('Error calling parseRequest - no reply sent');
		}
		else {
			self._sendReplyTweet(tweet, message);
		}
	}

	function parseRequest(tweet){
		var username = tweet.user.screen_name;
		var words = tweet.text;
    var filter = words.match(/banjir|flood/gi);
		var language = self._parseLangsFromTweet(tweet)[0];

    if (filter){filter = filter[0];}

    switch (filter){
      case null:
        self.logger.info('Bot could not detect request keyword');
				self._ahoy(username, language, botTweet); //Respond with default
				break;

      case 'banjir':
        self.logger.info('Bot detected request keyword "banjir"');
        self._getCardLink(username, self.config.cognicity.network, language, botTweet);
				break;

      case 'flood':
        self.logger.info('Bot detected request keyword "flood"');
				self._getCardLink(username, self.config.cognicity.network, language, botTweet);
				break;
    }
	}

	function sendAhoy(tweet){
		var username = tweet.user.screen_name;
		var language = self._parseLangsFromTweet(tweet)[0];

		self._ifNewUser(username, function(username_hash){
			self._ahoy(username, language, botTweet); //Respond with default
			self.insertInvitee(tweet);
		});
		return;
	}

	self.logger.silly("Processing tweet:");
	self.logger.silly(JSON.stringify(tweet));

	//TODO should we respond to retweets the same as tweets?
	// if (tweet.retweeted_status){};

	// Keyword check
	for (var i=0; i<self.config.twitter.keywords.length; i++){
		var re = new RegExp(self.config.twitter.keywords[i], "gi");
		if (tweet.text.match(re)){
			self.logger.debug("Tweet matches keyword: " + self.config.twitter.keywords[i]);

			// Username check
			for (var j=0; j<self.config.twitter.usernames.length; j++){
				var userRegex = new RegExp(self.config.twitter.usernames[j], "gi");
				if ( tweet.text.match(userRegex) ) {
					self.logger.debug("Tweet matches username: " + self.config.twitter.usernames[j]);
					// A confirmed input, ask Bot to scan for keywords and form response
					parseRequest(tweet);
					return;
				}
				else if ( j === self.config.twitter.usernames.length-1 ) {
					self.logger.debug("Tweet does not match any usernames");
					// End of usernames list, no match so message is unconfirmed
					// An unconfirmed input, ask bot to form ahoy response
					sendAhoy(tweet);
					return;
				}
			}
		}
	}
	self.logger.debug("Tweet processing ended without calling any actions");
};

/**
 * Insert an invited user into the database
 * @param {Tweet} tweet The tweet object insert invitee from
 */
TwitterDataSource.prototype.insertInvitee = function(tweet) {
	var self = this;

	self._baseInsertInvitee(tweet.user.screen_name);
};

/**
 * Send @reply Twitter message
 * @param {Tweet} tweet The tweet object this is a reply to
 * @param {string} message The tweet text to send
 * @param {function} success Callback function called on success
 */
TwitterDataSource.prototype._sendReplyTweet = function(tweet, message, success) {
	var self = this;

	self._baseSendReplyTweet(
		tweet.user.screen_name,
		tweet.id_str,
		message,
		success
	);
};

/**
 * Convert twitter custom date format to ISO8601 format.
 * @param {string} Twitter date string
 * @returns {string} ISO8601 format date string
 */
TwitterDataSource.prototype._twitterDateToIso8601 = function(twitterDate) {
	return moment(twitterDate, "ddd MMM D HH:mm:ss Z YYYY").toISOString();
};

/**
 * Parse language code from the tweet data.
 * @param {Tweet} tweet The tweet object to read languages from
 */
TwitterDataSource.prototype._parseLangsFromTweet = function(tweet) {
	// Fetch the language codes from twitter data, if present
	var langs = [];

	if (tweet.lang) langs.push(tweet.lang);

	return langs;
};

/**
 * Returns text to be tweeted to the user based on the dialogue type
 * @param  {String} dialogue Dialogue Type (ahoy, requests.card)
 * @param  {String} language Text string containing ISO 639-1 two letter language code e.g. 'en', 'id'
 */
TwitterDataSource.prototype._getDialogue = function(dialogue, language){
	var self = this;
	if (language in dialogue === false) {
		language = self.config.twitter.defaultLanguage;
	}
	return (dialogue[language]);
};

TwitterDataSource.prototype._ahoy = function(username, language, callback){
	var self = this;
	callback(null, self._getDialogue(dialogue.ahoy, language));
};

TwitterDataSource.prototype._getCardLink = function(username, network, language, callback) {
	var self = this;

	var card_request = {"username": username,
      								"network": network,
											"language": language
										};

  // Get a card from Cognicity server
  request({
    url: options.host + options.path,
    method: options.method,
    headers: options.headers,
    port: options.port,
    json: true,
    body: card_request
  }, function(error, response, body){
    if (!error && response.statusCode === 200){
      self.logger.info('Fetched card id: ' + body.cardId);
      // Construct the card link to be sent to the user
      var cardLink = process.env.CARD_PATH + body.cardId + '/report';
			var messageText =  self._getDialogue(dialogue.requests.card, language) + ' ' + cardLink;
			callback(null, messageText);
    } else {
			var err = 'Error getting card: ' + JSON.stringify(error) + JSON.stringify(response);
      self.logger.error(err);
			callback(err, null);
    }
  });
};

// Export the TwitterDataSource constructor
module.exports = TwitterDataSource;
