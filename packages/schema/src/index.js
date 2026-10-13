const lesson = require("./lesson.js");
const student = require("./student.js");
const record = require("./record.js");
const parentFeed = require("./parentFeed.js");

module.exports = { ...lesson, ...student, ...record, ...parentFeed };
