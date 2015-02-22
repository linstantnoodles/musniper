
var connect = require("connect");
var serveStatic = require("serve-static");
var moment = require("moment-timezone");
var request = require("request");
var twilio = require("twilio");
var twilioClient = twilio(process.env.ACCT_SID, process.env.AUTH_TOKEN);
var prettyjson = require("prettyjson");
var remaining = 30;
var complete = false;

// numeric value of UTC in ms
function getDate(time) {
  return moment(time).tz("America/New_York").format("dddd, MMMM Do YYYY, h:mmA");
}

// a and b are seconds
// return ms
function getDelay(a, b) {
  var ms = (Math.floor(Math.random() * (b - a)) + a) * 1000;
  console.log("Next request in " + ms + " ms.");
  return ms;
}

function sendSms(msg) {
  twilioClient.messages.create({
    body: msg,
    to: process.env.TO_PHONE,
    from: process.env.FROM_PHONE
  }, function(err, msg) {
    if (err) {
      console.log("Unable to send text.");
    } else {
      console.log("Message " + msg.sid + " sent!");
    }
  });
}

var days = function(future) {
  var now = Date.now();
  var diff = future - now;
  var seconds = diff / 1000;
  var minutes = seconds / 60;
  var hours = minutes / 60;
  var days = hours / 24;
  return days;
};

function findEvent() {
  var url = "https://api.meetup.com/2/groups?&sign=true&photo-host=public&group_urlname=" + process.env.GROUP_NAME + "&fields=next_event&page=20" + "&key=" + process.env.MEETUP_KEY;
  request(url, function(err, res, body) {
    if (err || res.statusCode !== 200) {
      console.log(err);
      console.log(res);
    } else {
      console.log("Found the group!");
      console.log("Rate info:");
      var headers = res.headers;
      var rateInfo = {
        remaining: headers['x-ratelimit-remaining'],
        reset: headers['x-ratelimit-reset']
      };
      // Update so we dont go over
      remaining = rateInfo.remaining;
      console.log(rateInfo);
      var results = JSON.parse(body).results[0];
      if (results.next_event) {
        console.log("We found an event!!");
        console.log(results.next_event);
        var d = days(results.next_event.time);
        console.log("The event begins in " + d + " days");
        console.log("Getting event details");
        getEvent(results.next_event.id);
      } else {
        console.log("Bummer. No upcoming event.");
      }
    }
  });
}

function getEvent(id) {
  var url = "https://api.meetup.com/2/event/" + id + "?&sign=true&photo-host=public&fields=rsvpable&page=20" + "&key=" + process.env.MEETUP_KEY;

  request(url, function(err, res, body) {
    if (err || res.statusCode !== 200) {
      console.log(err);
      console.log(res);
    } else {
      var result = JSON.parse(body);
      console.log("Found the event!");
      console.log("Status: " + result.status);
      var attendance = result.yes_rsvp_count;
      console.log("There are " + attendance + " people going.");
      console.log("Can I RSVP?");
      if (result.rsvpable) {
        console.log("Cool! I can RSVP. Lets do it.");
        getSurveyQuestions(id);
      } else {
        console.log("Nope ... sry.");
      }
    }
  });
};

function getSurveyQuestions(id) {
  var url = "https://api.meetup.com/2/event/" + id + "?&sign=true&photo-host=public&fields=survey_questions&page=20" + "&key=" + process.env.MEETUP_KEY;
  request(url, function(err, res, body) {
    if (err || res.statusCode !== 200) {
      console.log(err);
      console.log(res);
    } else {
      var result = JSON.parse(body);
      var eventData = {
        name: result.name,
        questions: result.survey_questions,
        date: getDate(result.time),
        address: result.venue.address_1,
        link: result.event_url
      };
      if (result.survey_questions) {
        console.log("Found survey questions for " + result.name);
      }
      rsvp(id, eventData);
    }
  });
}

function rsvp(id, eventData) {
  console.log("RSVPing baby...");
  var url = "https://api.meetup.com/2/rsvp/";
  var questions = eventData.questions || {};
  var res = {
    event_id: id,
    key: process.env.MEETUP_KEY,
    rsvp: "yes"
  };
  // Answer questions
  for (var i = 0; i < questions.length; i++) {
    var question = questions[i];
    console.log("Adding answer for question: " + question.id);
    res["answer_" + question.id] = "Alan Lin";
  }
  if (questions.length) {
    console.log("All questions are answered!");
  }
  console.log(res);
  request.post({
    url: url, 
    formData: res
  }, function (err, res, body) {
    if (err || res.statusCode !== 201) {
      console.log(err);
      console.log(res);
    } else {
      console.log("RSVP successful. Have fun!");
      var textMsg = "Mr. Lin, you have been RSVP'd for " + 
        eventData.name + 
        " which takes place at " 
        + eventData.address + " on " 
        + eventData.date + "." +
        " You can find more info here: " + eventData.link + 
        "." + " Have a great day!";
      sendSms(textMsg);
    }
    // Stop looping
    complete = true;
  });
}

// The sniper
var snipe = function () {
  if (complete) {
    return;
  }
  console.log("Can we make a request?");
  // If we still have stuff remaining ...
  if (remaining >= 5) {
    console.log("Yup!");
    console.log("Finding event for group : " + process.env.GROUP_NAME);
    findEvent();
  } else {
    console.log("Nope. Lets wait a bit.");
  }
  // Delay it between 1 to 1800 seconds (30min)
  setTimeout(snipe, getDelay(1, process.env.MAX_DELAY));
};

// Kickoff
setTimeout(snipe, getDelay(1, process.env.MAX_DELAY));
// Webserver for status pinging
console.log("Starting web server");
connect().use(serveStatic(__dirname)).listen(process.env.PORT || 8080);
