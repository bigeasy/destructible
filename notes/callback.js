var cadence = require('cadence')
var Destructible = require('..')

var destructible = new Destructible('swallow')

destructible.monitor('monitor', cadence(function (async, ready) {
    async(function () {
        setImmediate(async())
    }, function () {
        ready.unlatch()
    })
}))

destructible.timeout(250, function () {
    throw new Error
})
