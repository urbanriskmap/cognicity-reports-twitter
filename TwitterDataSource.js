'use strict';

// Prototype object this object extends from - contains basic twitter interaction functions
var BaseTwitterDataSource = require('../BaseTwitterDataSource/BaseTwitterDataSource.js');

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
	
	function generateInsertInviteeCallback(tweet) {
		return function() {
			self.insertInvitee(tweet);
		};
	}
	
	self.logger.silly("Processing tweet:");
	self.logger.silly(JSON.stringify(tweet));
	
	// Retweet handling
	if ( tweet.retweeted_status ) {
		// Catch tweets from authorised user to verification - handle verification and then continue processing the tweet
		if ( tweet.user.screen_name === self.config.twitter.usernameVerify ) {
			self._processVerifiedReport( tweet.retweeted_status.id_str );
		} else {
			// If this was a retweet but not from our verification user, ignore it and do no further processing
			self.logger.debug( "filter: Ignoring retweet from user " + tweet.user.screen_name );
			return;
		}
	}
	
	// Keyword check
	for (var i=0; i<self.config.twitter.keywords.length; i++){
		var re = new RegExp(self.config.twitter.keywords[i], "gi");
		if (tweet.text.match(re)){
			self.logger.silly("Tweet matches keyword: " + self.config.twitter.keywords[i]);
			
			// Username check
			for (var j=0; i<self.config.twitter.usernames.length; j++){
				var userRegex = new RegExp(self.config.twitter.usernames[j], "gi");
				if ( tweet.text.match(userRegex) ) {
					self.logger.silly("Tweet matches username: " + self.config.twitter.usernames[j]);
					
					// regexp for city
					var cityRegex = new RegExp(self.config.twitter.city, "gi");
					
					// Geo check
					if ( tweet.coordinates !== null ){
						self.logger.silly("Tweet has coordinates, confirmed report");
						
						self.insertConfirmed(tweet); //user + geo = confirmed report!
						
					} else if(tweet.place !== null && tweet.place.name.match(cityRegex) || tweet.user.location !== null && tweet.user.location.match(cityRegex)){
						self.logger.silly("Tweet matches city or location: " + self.config.twitter.city);
						
						// City location check
						self.insertNonSpatial( tweet ); // User sent us a message but no geo, log as such
						self._sendReplyTweet( tweet, self._getMessage('thanks_text', tweet) ); // send geo reminder
					}
					return;
					
				} else if ( j === self.config.twitter.usernames.length-1 ) {
					self.logger.silly("Tweet does not match any usernames");
					// End of usernames list, no match so message is unconfirmed
					
					// Geo check
					if ( tweet.coordinates !== null ) {
						self.logger.silly("Tweet has coordinates - unconfirmed report, invite user");
						
						self.insertUnConfirmed(tweet); // insert unconfirmed report, then invite the user to participate
						self._sendReplyTweet(
							tweet, 
							self._getMessage('invite_text', tweet), 
							generateInsertInviteeCallback(tweet)
						);	
						
					} else {
						self.logger.silly("Tweet has no geo data - keyword was present, invite user");
						
						// no geo, no user - but keyword so send invite
						self._sendReplyTweet(
							tweet, 
							self._getMessage('invite_text', tweet), 
							generateInsertInviteeCallback(tweet)
						);
					}
					
					return;
				}	
			}
		}
	}
	
	self.logger.silly("Tweet processing ended without calling any actions");
};

/**
 * Resolve message code from config.twitter using passed language codes.
 * Will fall back to trying to resolve message using default language set in configuration.
 * @param {string} code Message code to lookup in config.twitter
 * @param {Tweet} tweet The tweet object to fetch language code from
 * @returns {?string} Message text, or null if not resolved.
 */
TwitterDataSource.prototype._getMessage = function(code, tweet) {
	var self = this;

	return self._baseGetMessage(code, self._parseLangsFromTweet(tweet) );
};

/**
 * Insert a confirmed tweet report into the database
 * @param {Tweet} tweet The tweet object insert confirmed report from
 */
TwitterDataSource.prototype.insertConfirmed = function(tweet) {
	var self = this;
	
	self._baseInsertConfirmed(
		tweet.user.screen_name, 
		self._parseLangsFromTweet(tweet), 
		tweet.id_str, 
		self._twitterDateToIso8601(tweet.created_at), 
		tweet.text, 
		JSON.stringify(tweet.entities.hashtags), 
		JSON.stringify(tweet.entities.urls), 
		JSON.stringify(tweet.entities.user_mentions), 
		tweet.lang, 
		"", 
		tweet.coordinates.coordinates[0]+" "+tweet.coordinates.coordinates[1]
	);
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
 * Insert an unconfirmed tweet report into the database
 * @param {Tweet} tweet The tweet object insert unconfirmed report from
 */
TwitterDataSource.prototype.insertUnConfirmed = function(tweet) {
	var self = this;

	self._baseInsertUnConfirmed(
		self._twitterDateToIso8601(tweet.created_at),
	    tweet.coordinates.coordinates[0]+" "+tweet.coordinates.coordinates[1]
	);
};

/**
 * Insert a non-spatial tweet report into the database
 * @param {Tweet} tweet The tweet object insert non-spatial report from
 */
TwitterDataSource.prototype.insertNonSpatial = function(tweet) {
	var self = this;

	self._baseInsertNonSpatial(
		tweet.user.screen_name,
		self._twitterDateToIso8601(tweet.created_at),
		tweet.text,
		JSON.stringify(tweet.entities.hashtags),
		JSON.stringify(tweet.entities.urls),
		JSON.stringify(tweet.entities.user_mentions),
		tweet.lang
	);
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

// Export the TwitterDataSource constructor
module.exports = TwitterDataSource;
