const mongoose = require('mongoose')
const { Schema } = mongoose;
const cardSchema = new Schema({
    cardNumber: { type : Number , required : true},
    suite: { type: String, required: true},
    flipped : { type: Boolean, required: true},
    positionInDeck : { type: Number, required: true, unique: true},
    frontImage : { type: Image, required: true},
    backImage: { type: Image}
});

module.exports.cardSchema = cardSchema;
module.exports.Card = mongoose.model('cards', cardSchema);