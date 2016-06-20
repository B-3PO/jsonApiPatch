var paths = require('./config').paths;

var gulp = require('gulp');
var jshint = require('gulp-jshint');
var wrap = require("gulp-wrap");
var concat = require('gulp-concat');
var uglify = require('gulp-uglify');
var stripDebug = require('gulp-strip-debug');
var rename = require("gulp-rename");
var filter = require('gulp-filter');
var gutil = require('gulp-util');



exports.getDev = function (srcs) {
  srcs = srcs || paths.scripts;

  return function dev() {
    return gulp.src(srcs, {base: paths.app})
      .pipe(wrap('(function(){"use strict";<%= contents %>}());'))
      .pipe(jshint())
      .pipe(jshint.reporter('default'))
      .pipe(gulp.dest(paths.dest))
      .on('end', function() {
        gutil.log(gutil.colors.green('✔ JS build'), 'Finished');
      });
  };
}
