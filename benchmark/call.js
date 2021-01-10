const Benchmark = require('benchmark')

const suite = new Benchmark.Suite

class Worker {
    work() {
    }
}

const worker = new Worker

const bound = worker.work.bind(worker)
const enclosed = () => worker.work()
const call = { object: worker, f: worker.work }

bound()

suite.add({
    name: 'bound',
    fn: () => bound()
})

suite.add({
    name: 'closure',
    fn: () => enclosed()
})

suite.add({
    name: 'call',
    fn: () => call.f.call(call.object)
})

suite.on('cycle', function(event) {
    console.log(String(event.target));
})

suite.on('complete', function() {
    console.log('Fastest is ' + this.filter('fastest').map('name'));
})

suite.run()
