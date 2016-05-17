//sample-config.js - sample configuration file for cognicity-reports module

var config = {};

//Twitter stream config
config.twitter = {};
config.twitter.stream = true; //Set to false to turn off twitter connection (for testing)

//Twitter stream parameters
config.twitter.send_enabled = false; //send verfication requests?

config.twitter.bbox = '106.5894, -6.4354, 107.0782, -5.9029'; // Jakarta appx.
config.twitter.track = 'flood, banjir'; //Twitter track keywords
config.twitter.users = '@petajkt'; //Verification twitter account
config.twitter.timeout = 900000; //Default twitter stream timeout (milliseconds) 600000 (10 minutes)
config.twitter.city = 'jakarta'; //User profile location keyword

config.twitter.usernameVerify = ''; // Twitter username (without @) authorised to verify reports via retweet functionality
config.twitter.usernameReplyBlacklist = ''; // Twitter usernames (without @, comma separated for multiples) which will never be sent to in response to tweet processing

config.twitter.stream = true; //connect to stream and log reports?
//Append a timestamp to each sent tweet except response to confirmed reports with unique urls
config.twitter.addTimestamp = true;

//Twitter app authentication details
config.twitter.consumer_key = '';
config.twitter.consumer_secret = '';
config.twitter.access_token_key = '';
config.twitter.access_token_secret = '';

config.pg = {};
config.pg.table_all_users = 'tweet_all_users';
config.pg.table_tweets = 'tweet_reports';
config.pg.table_invitees = 'tweet_invitees';
config.pg.table_unconfirmed = 'tweet_reports_unconfirmed';
config.pg.table_nonspatial_tweet_reports = 'nonspatial_tweet_reports';
config.pg.table_nonspatial_users = 'nonspatial_tweet_users';

//Twitter message texts
config.twitter.invite_text = {};
config.twitter.invite_text.in = 'Invite/Verification Tweet Text [IN]';
config.twitter.invite_text.en = 'Invite/Verification Tweet Text [EN]';
config.twitter.thanks_text = {};
config.twitter.thanks_text.in = 'Thanks/location-enabled reminder Tweet Text [IN]';
config.twitter.thanks_text.en = 'Thanks/location-enabled reminder Tweet Text [EN]';

module.exports = config;
