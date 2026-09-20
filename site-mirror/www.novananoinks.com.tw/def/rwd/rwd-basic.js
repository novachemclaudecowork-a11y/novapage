(function(factory){if(typeof define==='function'&&define.amd){define(['jquery'],factory)}else if(typeof exports==='object'){module.exports=factory(require('jquery'))}else{factory(jQuery)}}(function($){var pluses=/\+/g;function encode(s){return config.raw?s:encodeURIComponent(s)}function decode(s){return config.raw?s:decodeURIComponent(s)}function stringifyCookieValue(value){return encode(config.json?JSON.stringify(value):String(value))}function parseCookieValue(s){if(s.indexOf('"')===0){s=s.slice(1,-1).replace(/\\"/g,'"').replace(/\\\\/g,'\\')}try{s=decodeURIComponent(s.replace(pluses,' '));return config.json?JSON.parse(s):s}catch(e){}}function read(s,converter){var value=config.raw?s:parseCookieValue(s);return $.isFunction(converter)?converter(value):value}var config=$.cookie=function(key,value,options){if(arguments.length>1&&!$.isFunction(value)){options=$.extend({},config.defaults,options);if(typeof options.expires==='number'){var days=options.expires,t=options.expires=new Date();t.setMilliseconds(t.getMilliseconds()+days*864e+5)}return(document.cookie=[encode(key),'=',stringifyCookieValue(value),options.expires?'; expires='+options.expires.toUTCString():'',options.path?'; path='+options.path:'',options.domain?'; domain='+options.domain:'',options.secure?'; secure':''].join(''))}var result=key?undefined:{},cookies=document.cookie?document.cookie.split('; '):[],i=0,l=cookies.length;for(;i<l;i++){var parts=cookies[i].split('='),name=decode(parts.shift()),cookie=parts.join('=');if(key===name){result=read(cookie,value);break}if(!key&&(cookie=read(cookie))!==undefined){result[name]=cookie}}return result};config.defaults={};$.removeCookie=function(key,options){$.cookie(key,'',$.extend({},options,{expires:-1}));return!$.cookie(key)}}));

var $window = $(window);
var windowsize = $window.width();

var PdListStyle=$.cookie('PdListStyle');
if (PdListStyle==""){
	PdListStyle="1";
}

function DivPic(){
				if (windowsize >= 802){
					//$("#ShowTypePic ul").css({"width":"802px"});
					$("#ShowTypePic ul").css({"width":"<%=((def_website_width_right\(pic_fix_ww+23))*(pic_fix_ww+23))-(def_website_width_right\(pic_fix_ww+23))+1 %>px"});

				} else if (windowsize >= 768) {
					$("#ShowTypePic ul").css({"width":"100%"});
				} else if (windowsize >= 320) {
			
					//$("#ShowTypePic ul").css({"width":"100%"});
					
					var WidthNew = (windowsize/2)-40;
					$(".DivPic").css({"width":WidthNew+"px","height":WidthNew+"px","background-size":"cover"});
					$("#ShowTypePic ul").css({"width":(WidthNew+26)*2+"px"});


					//$(".DivPicOut div").removeAttr('class').addClass("DivPicVw");
					//$(".DivPic").css({"background-size":"cover"});
					
					//$(".LiTable1").css({"width":"auto"});
				} else {
					$("#ShowTypePic ul").css({"width":"100%","text-align":"center"});
					$(".DivPicOut div").removeAttr('class').addClass("DivPic");
					$(".DivPic").css({"background-size":"auto"});
				}


}

$(document).ready(function(){
	function checkWidth() {
		//console.log('resize triggered')
	
		DivPic();
    }

	//$( "p" ).removeClass( "myClass noClass" ).addClass( "yourClass" );


    // can trigger the resize handler instead of
    // explicitly calling checkWidth()
    $(window).resize(checkWidth).trigger('resize');


	$(".ProductSpec table").each(function(){ 
		var w=$(this).width();
		if (w>780) {
			$(this).attr("width","");
			$(this).css({"width":"780px"});
		}
	});


});
