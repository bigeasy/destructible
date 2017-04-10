require('proof')(1, prove)

function prove (assert, callback) {
    var now = 0
    var Scheduler = require('happenstance').Scheduler
    var Terminator = require('../terminator')
    var terminator = new Terminator(100, {
        setImmediate: function (f) {
            try {
                f()
            } catch (error) {
                assert(/^destructible#hung$/m.test(error.message), 'hung')
                callback()
            }
        }
    })
    terminator.push({})
    terminator.push({
        from: 'x',
        method: 'destroyed',
        body: { waiting: [] }
    })
    terminator.push({
        from: 'x',
        method: 'destroyed',
        body: { waiting: [ 'c' ] }
    })
}