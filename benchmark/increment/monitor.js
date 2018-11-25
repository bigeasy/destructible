var Destructible = require('../../destructible')
var Destructible_ = require('../../_destructible')
var Benchmark = require('benchmark')

var suite = new Benchmark.Suite('call')

function monitor (Destructible) {
    return function () {
        new Destructible('destructible').monitor('example')(null)
    }
}

monitor(Destructible)()

for (var i = 1; i <= 4; i++)  {
    suite.add({
        name: '_destructible monitor ' + i,
        fn: monitor(Destructible_)
    })

    suite.add({
        name: ' destructible monitor ' + i,
        fn: monitor(Destructible)
    })
}

suite.on('cycle', function(event) {
    console.log(String(event.target));
})

suite.on('complete', function() {
    console.log('Fastest is ' + this.filter('fastest').map('name'));
})

suite.run()
