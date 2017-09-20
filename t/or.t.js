require('proof')(1, prove)

function prove (okay) {
    var or = require('../or')

    or(function (callback) {
        callback(null, 1)
        callback(null, 3)
    }, function (error, value) {
        okay(value, 1, 'or')
    })
}
