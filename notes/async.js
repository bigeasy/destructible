var cadence = require('cadence')
var Destructible = require('..')

var destructible = new Destructible('swallow')

cadence(function (async) {
    destructible.monitor(async, 'monitor')(function (ready) {
        async(function () {
            setImmediate(async())
        }, function () {
            ready.unlatch()
        })
    })
})(function (error) {
    console.log('caught', error.message)
})

destructible.timeout(250, function () {
    throw new Error('thrown')
})
