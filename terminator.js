var Scheduler = require('happenstance').Scheduler
var Timer = require('happenstance').Timer

function Terminator (timeout) {
    this._timeout = timeout
    this.scheduler = new Scheduler()
    this.scheduler.events.pump(new Timer(this.scheduler))
    this.scheduler.events.pump(function (envelope) {
        if (envelope.method != 'event') {
            return
        }
        setImmediate(function () {
            body = envelope.body.body.body
            interrupt = body.interrupt
            throw interrupt('hung', {
                destructor: body.destructor,
                destructible: body.destructible,
                waiting: body.waiting
            }, {
                cause: body.cause
            })
        })
    })
}

Terminator.prototype.push = function (envelope) {
    switch (envelope.method) {
    case 'destroyed':
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
