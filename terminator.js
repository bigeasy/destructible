var Scheduler = require('happenstance').Scheduler
var Timer = require('happenstance').Timer
var coalesce = require('extant')
var interrupt = require('interrupt').createInterrupter('destructible')

function Terminator (timeout, options) {
    options = coalesce(options, {})
    var _setImmediate = coalesce(options.setImmediate, setImmediate)
    this._timeout = timeout
    this.scheduler = coalesce(new Scheduler)
    this.scheduler.events.pump(new Timer(this.scheduler), 'push')
    this.scheduler.events.pump(function (envelope) {
        if (envelope.method != 'event') {
            return
        }
        _setImmediate(function () {
            var body = envelope.body.body.body
            throw interrupt('hung', {
                destructor: body.destructor,
                destructible: body.destructible,
                waiting: body.waiting
            }, {
                cause: body.errors[0]
            })
        })
    })
}

Terminator.prototype.push = function (envelope) {
    switch (envelope.method) {
    case 'destroyed':
        if (!envelope.body.destroyed) {
            break
        }
    case 'popped':
        if (envelope.body.waiting.length == 0) {
            this.scheduler.unschedule(envelope.from)
        } else {
            this.scheduler.schedule(Date.now() + this._timeout, envelope.from, {
                module: 'destructible',
                method: 'timeout',
                body: envelope
            })
        }
        break
    }
}

module.exports = Terminator
